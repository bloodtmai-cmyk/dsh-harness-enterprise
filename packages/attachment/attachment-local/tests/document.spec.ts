import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import { extractOfficeDocument, readDocumentFile, saveDocumentFile } from '../src/document.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const encoder = new TextEncoder()

const limits: DocumentAttachmentLimits = {
  maxDocumentBytes: 1024 * 1024,
  maxDocumentsPerMessage: 5,
  maxMessageDocumentBytes: 5 * 1024 * 1024,
  maxExtractedCharacters: 1000,
  mediaTypes: [DOCX, XLSX, PPTX],
}

function office(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types/>',
    ...entries,
  }).map(([name, value]) => [name, encoder.encode(value)])))
}

describe('Office document admission', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('extracts paragraphs from DOCX', () => {
    const data = office({
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>',
    })
    expect(extractOfficeDocument({ data, mediaType: DOCX, name: 'report.docx' }, limits)).toEqual({
      text: '第一段\n第二段',
      truncated: false,
    })
  })

  it('resolves XLSX shared strings and numeric cells', () => {
    const data = office({
      'xl/workbook.xml': '<workbook/>',
      'xl/sharedStrings.xml': '<sst><si><t>产品</t></si><si><t>收入</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>光纤</v></c><c><v>420</v></c></row></sheetData></worksheet>',
    })
    expect(extractOfficeDocument({ data, mediaType: XLSX, name: 'sales.xlsx' }, limits).text)
      .toBe('[工作表 1]\n产品\t收入\n光纤\t420')
  })

  it('extracts slide text from PPTX and persists the original bytes', async () => {
    const data = office({
      'ppt/presentation.xml': '<p:presentation/>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>经营分析</a:t></a:r></a:p><a:p><a:r><a:t>库存下降</a:t></a:r></a:p></p:sld>',
    })
    const home = await mkdtemp(join(tmpdir(), 'dsh-doc-'))
    roots.push(home)
    const root = join(home, 'attachments', 'v1')
    const saved = await saveDocumentFile(root, { data, mediaType: PPTX, name: 'C:\\fake\\analysis.pptx' }, limits)
    expect(saved.text).toBe('[幻灯片 1]\n经营分析\n库存下降')
    expect(saved.ref.name).toBe('analysis.pptx')
    const stored = await readDocumentFile(root, saved.ref)
    expect(Buffer.from(stored.data)).toEqual(Buffer.from(data))
    expect(await readFile(join(root, 'objects', String(saved.ref.attachmentId).slice(7, 9), String(saved.ref.attachmentId).slice(7))))
      .toEqual(Buffer.from(data))
  })

  it('rejects a declared type whose required OOXML part is missing', () => {
    const data = office({ 'xl/workbook.xml': '<workbook/>' })
    expect(() => extractOfficeDocument({ data, mediaType: DOCX, name: 'wrong.docx' }, limits))
      .toThrow(/required package part/)
  })
})
