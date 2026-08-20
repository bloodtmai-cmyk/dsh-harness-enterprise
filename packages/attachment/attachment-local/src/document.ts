/** Bounded extraction and durable storage for modern Office Open XML files. */

import { unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type {
  DocumentAttachmentLimits,
  DocumentAttachmentRef,
  DocumentMediaType,
  SavedDocumentAttachment,
  SaveDocumentAttachment,
  StoredDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import { readAttachmentBytes, safeAttachmentName, saveAttachmentBytes } from './store.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_XML_ENTRY_BYTES = 16 * 1024 * 1024

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  processEntities: false,
})

const objectParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
  isArray: name => name === 'row' || name === 'c' || name === 'si' || name === 't' || name === 'r',
})

interface ExtractedDocument {
  text: string
  truncated: boolean
}

function acceptedEntries(mediaType: DocumentMediaType, name: string): boolean {
  if (name === '[Content_Types].xml') return true
  if (mediaType === DOCX) return name === 'word/document.xml'
  if (mediaType === XLSX) return name === 'xl/workbook.xml' || name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  return name === 'ppt/presentation.xml' || /^ppt\/slides\/slide\d+\.xml$/.test(name)
}

function packageEntries(input: SaveDocumentAttachment): Record<string, Uint8Array> {
  try {
    return unzipSync(input.data, {
      filter: (file) => {
        if (file.originalSize > MAX_XML_ENTRY_BYTES) {
          throw new AttachmentError('Office document contains an XML part that exceeds the extraction limit.', 'INVALID_DOCUMENT')
        }
        return acceptedEntries(input.mediaType, file.name)
      },
    })
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Office document is not a readable OOXML package.', 'INVALID_DOCUMENT', { cause: error })
  }
}

function requirePackagePart(entries: Record<string, Uint8Array>, path: string): void {
  if (entries[path] === undefined) {
    throw new AttachmentError(`Office document is missing required package part ${path}.`, 'DOCUMENT_TYPE_MISMATCH')
  }
}

function orderedChildren(value: unknown, tag: string): unknown[] {
  const found: unknown[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node !== 'object' || node === null) return
    for (const [key, child] of Object.entries(node)) {
      if (key === tag) found.push(child)
      visit(child)
    }
  }
  visit(value)
  return found
}

function orderedText(value: unknown, textTag: string): string {
  const chunks: string[] = []
  for (const node of orderedChildren(value, textTag)) {
    for (const textNode of orderedChildren(node, '#text')) {
      if (typeof textNode === 'string' || typeof textNode === 'number') chunks.push(String(textNode))
    }
  }
  return chunks.join('')
}

function xml(entries: Record<string, Uint8Array>, path: string): string {
  const data = entries[path]
  if (data === undefined) throw new AttachmentError(`Office document is missing ${path}.`, 'INVALID_DOCUMENT')
  return new TextDecoder('utf-8', { fatal: true }).decode(data)
}

function extractDocx(entries: Record<string, Uint8Array>): string {
  requirePackagePart(entries, 'word/document.xml')
  const document = orderedParser.parse(xml(entries, 'word/document.xml')) as unknown
  return orderedChildren(document, 'w:p')
    .map(paragraph => orderedText(paragraph, 'w:t').trimEnd())
    .filter(Boolean)
    .join('\n')
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function nestedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(nestedText).join('')
  if (typeof value !== 'object' || value === null) return ''
  return Object.entries(value)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, child]) => nestedText(child))
    .join('')
}

function extractXlsx(entries: Record<string, Uint8Array>): string {
  requirePackagePart(entries, 'xl/workbook.xml')
  const sharedRoot = entries['xl/sharedStrings.xml'] === undefined
    ? undefined
    : objectParser.parse(xml(entries, 'xl/sharedStrings.xml')) as { sst?: { si?: unknown[] } }
  const shared = asArray(sharedRoot?.sst?.si).map(nestedText)
  const sheets = Object.keys(entries)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1]) - Number(/(\d+)/.exec(b)?.[1]))
  if (sheets.length === 0) throw new AttachmentError('Spreadsheet contains no worksheets.', 'INVALID_DOCUMENT')
  return sheets.map((path, sheetIndex) => {
    const root = objectParser.parse(xml(entries, path)) as {
      worksheet?: { sheetData?: { row?: Array<{ c?: Array<{ '@_t'?: string; v?: unknown; is?: unknown }> }> } }
    }
    const rows = asArray(root.worksheet?.sheetData?.row).map(row => asArray(row.c).map((cell) => {
      const raw = nestedText(cell.v)
      if (cell['@_t'] === 's') return shared[Number(raw)] ?? ''
      if (cell['@_t'] === 'inlineStr') return nestedText(cell.is)
      return raw
    }).join('\t'))
    return [`[工作表 ${sheetIndex + 1}]`, ...rows].join('\n')
  }).join('\n\n')
}

function extractPptx(entries: Record<string, Uint8Array>): string {
  requirePackagePart(entries, 'ppt/presentation.xml')
  const slides = Object.keys(entries)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1]) - Number(/(\d+)/.exec(b)?.[1]))
  if (slides.length === 0) throw new AttachmentError('Presentation contains no slides.', 'INVALID_DOCUMENT')
  return slides.map((path, index) => {
    const slide = orderedParser.parse(xml(entries, path)) as unknown
    const lines = orderedChildren(slide, 'a:p').map(paragraph => orderedText(paragraph, 'a:t')).filter(Boolean)
    return [`[幻灯片 ${index + 1}]`, ...lines].join('\n')
  }).join('\n\n')
}

/** Validate one OOXML package and extract bounded model-visible plain text. */
export function extractOfficeDocument(
  input: SaveDocumentAttachment,
  limits: DocumentAttachmentLimits,
): ExtractedDocument {
  if (input.data.byteLength === 0) throw new AttachmentError('Office document is empty.', 'INVALID_DOCUMENT')
  if (input.data.byteLength > limits.maxDocumentBytes) {
    throw new AttachmentError('Office document exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
  }
  const entries = packageEntries(input)
  const extracted = input.mediaType === DOCX
    ? extractDocx(entries)
    : input.mediaType === XLSX ? extractXlsx(entries) : extractPptx(entries)
  const normalized = extracted.replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').trim()
  const truncated = normalized.length > limits.maxExtractedCharacters
  return {
    text: truncated ? normalized.slice(0, limits.maxExtractedCharacters) : normalized,
    truncated,
  }
}

/** Validate and durably store one OOXML document. */
export async function saveDocumentFile(
  root: string,
  input: SaveDocumentAttachment,
  limits: DocumentAttachmentLimits,
): Promise<SavedDocumentAttachment> {
  const extracted = extractOfficeDocument(input, limits)
  const name = safeAttachmentName(input.name)
  if (name === undefined) throw new AttachmentError('Office document name is invalid.', 'INVALID_DOCUMENT')
  const attachmentId = await saveAttachmentBytes(root, input.data)
  return {
    ref: { attachmentId, mediaType: input.mediaType, bytes: input.data.byteLength, name },
    ...extracted,
  }
}

/** Read one OOXML document after digest, byte-length, and package-type verification. */
export async function readDocumentFile(
  root: string,
  ref: DocumentAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredDocumentAttachment> {
  const data = await readAttachmentBytes(root, ref, signal)
  extractOfficeDocument({ data, mediaType: ref.mediaType, name: ref.name }, {
    maxDocumentBytes: ref.bytes,
    maxDocumentsPerMessage: 1,
    maxMessageDocumentBytes: ref.bytes,
    maxExtractedCharacters: 1,
    mediaTypes: [ref.mediaType],
  })
  return { ref, data }
}
