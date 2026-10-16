import type { DocumentAttachmentRef, DocumentMediaType } from '@deepseek-ai/dsh-attachment'

interface DesktopAttachmentOpenResult {
  ok: boolean
  code?: string
}

interface DesktopAttachmentBridge {
  open: (request: {
    name: string
    mediaType: DocumentMediaType
    data: Uint8Array
  }) => Promise<DesktopAttachmentOpenResult>
}

declare global {
  interface Window {
    desktopAttachments?: DesktopAttachmentBridge
  }
}

/** Resolve immutable attachment bytes for one durable conversation reference. */
export type DocumentLoader = (attachment: DocumentAttachmentRef) => Promise<Uint8Array>

function downloadDocument(name: string, mediaType: DocumentMediaType, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data.slice().buffer], { type: mediaType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}

async function openDocumentBytes(
  name: string,
  mediaType: DocumentMediaType,
  data: Uint8Array,
): Promise<boolean> {
  const bridge = window.desktopAttachments
  if (bridge === undefined) {
    downloadDocument(name, mediaType, data)
    return true
  }
  const result = await bridge.open({ name, mediaType, data })
  return result.ok
}

/**
 * Open a draft Office file through the desktop default app, or download on Web.
 * @param file - browser-owned draft file whose bytes are read for this operation.
 * @returns whether the desktop bridge accepted opening, or the Web download was initiated.
 */
export async function openDraftDocument(file: File): Promise<boolean> {
  return await openDocumentBytes(
    file.name,
    file.type as DocumentMediaType,
    new Uint8Array(await file.arrayBuffer()),
  )
}

/**
 * Open a durable Office attachment through the desktop app or Web download path.
 * @param attachment - immutable conversation reference with its display name and media type.
 * @param load - session-authorized loader for the attachment bytes.
 * @returns whether opening was accepted; rejects when loading or bridge invocation fails.
 */
export async function openStoredDocument(
  attachment: DocumentAttachmentRef,
  load: DocumentLoader,
): Promise<boolean> {
  return await openDocumentBytes(attachment.name, attachment.mediaType, await load(attachment))
}
