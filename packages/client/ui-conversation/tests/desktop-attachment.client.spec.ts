// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { openStoredDocument } from '../src/client/desktop-attachment.ts'

const attachment: DocumentAttachmentRef = {
  attachmentId: 'sha256:test' as never,
  mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  bytes: 3,
  name: 'report.docx',
}

afterEach(() => {
  delete window.desktopAttachments
})

describe('desktop Office attachment bridge', () => {
  it('loads durable bytes only on click and hands them to the native opener', async () => {
    const open = vi.fn(() => Promise.resolve({ ok: true }))
    const load = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])))
    window.desktopAttachments = { open }

    await expect(openStoredDocument(attachment, load)).resolves.toBe(true)
    expect(load).toHaveBeenCalledWith(attachment)
    expect(open).toHaveBeenCalledWith({
      name: 'report.docx',
      mediaType: attachment.mediaType,
      data: new Uint8Array([1, 2, 3]),
    })
  })
})
