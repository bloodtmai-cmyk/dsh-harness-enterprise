import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024

const OFFICE_EXTENSIONS = new Map<string, string>([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
])
const pendingMaterializations = new Map<string, Promise<string>>()

export interface DesktopAttachmentOpenRequest {
  name: string
  mediaType: string
  data: Uint8Array
}

export class DesktopAttachmentOpenError extends Error {
  constructor(readonly code: 'invalid-request' | 'unsupported' | 'too-large') {
    super(code)
    this.name = 'DesktopAttachmentOpenError'
  }
}

function safeName(value: unknown): string {
  if (typeof value !== 'string') throw new DesktopAttachmentOpenError('invalid-request')
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 255)
  if (clean === '' || clean === '.' || clean === '..') throw new DesktopAttachmentOpenError('invalid-request')
  return clean
}

function requestBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new DesktopAttachmentOpenError('invalid-request')
  if (value.byteLength === 0) throw new DesktopAttachmentOpenError('invalid-request')
  if (value.byteLength > MAX_ATTACHMENT_BYTES) throw new DesktopAttachmentOpenError('too-large')
  return value
}

/** Validate a renderer request before any bytes reach the native file opener. */
export function parseDesktopAttachmentOpenRequest(request: unknown): DesktopAttachmentOpenRequest {
  if (typeof request !== 'object' || request === null) throw new DesktopAttachmentOpenError('invalid-request')
  const value = request as Record<string, unknown>
  const name = safeName(value.name)
  const mediaType = value.mediaType
  if (typeof mediaType !== 'string') throw new DesktopAttachmentOpenError('invalid-request')
  const expected = OFFICE_EXTENSIONS.get(mediaType)
  if (expected === undefined || extname(name).toLowerCase() !== expected) {
    throw new DesktopAttachmentOpenError('unsupported')
  }
  return { name, mediaType, data: requestBytes(value.data) }
}

/** Materialize one validated Office attachment into a content-addressed native-open cache. */
export async function materializeDesktopAttachment(
  request: DesktopAttachmentOpenRequest,
  cacheRoot: string,
): Promise<string> {
  const digest = createHash('sha256').update(request.data).digest('hex')
  const directory = join(cacheRoot, digest)
  const path = join(directory, request.name)
  const pending = pendingMaterializations.get(path)
  if (pending !== undefined) return await pending
  const materialization = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(path, request.data, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return path
  })()
  pendingMaterializations.set(path, materialization)
  try {
    return await materialization
  } finally {
    if (pendingMaterializations.get(path) === materialization) pendingMaterializations.delete(path)
  }
}
