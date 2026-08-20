import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopAttachmentOpenError,
  materializeDesktopAttachment,
  parseDesktopAttachmentOpenRequest,
} from '../src/attachment-open.ts'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop Office attachment opener', () => {
  it('sanitizes the display name and materializes a content-addressed file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-office-open-'))
    roots.push(root)
    const request = parseDesktopAttachmentOpenRequest({
      name: 'C:\\Users\\user\\report.xlsx',
      mediaType: XLSX,
      data: new Uint8Array([1, 2, 3]),
    })
    expect(request.name).toBe('report.xlsx')
    const [first, concurrent] = await Promise.all([
      materializeDesktopAttachment(request, root),
      materializeDesktopAttachment(request, root),
    ])
    const second = await materializeDesktopAttachment(request, root)
    expect(concurrent).toBe(first)
    expect(second).toBe(first)
    expect([...await readFile(first)]).toEqual([1, 2, 3])
  })

  it('rejects unsupported, mismatched, empty, and malformed requests', () => {
    const reject = (request: unknown, code: DesktopAttachmentOpenError['code']) => {
      try {
        parseDesktopAttachmentOpenRequest(request)
        throw new Error('expected parse to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(DesktopAttachmentOpenError)
        expect((error as DesktopAttachmentOpenError).code).toBe(code)
      }
    }
    reject({ name: 'macro.xlsm', mediaType: XLSX, data: new Uint8Array([1]) }, 'unsupported')
    reject({ name: 'report.docx', mediaType: XLSX, data: new Uint8Array([1]) }, 'unsupported')
    reject({ name: 'report.xlsx', mediaType: XLSX, data: new Uint8Array() }, 'invalid-request')
    reject({ name: 'report.xlsx', mediaType: XLSX, data: [1, 2, 3] }, 'invalid-request')
  })
})
