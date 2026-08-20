/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  DocumentAttachmentLimits,
  DocumentAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SavedDocumentAttachment,
  SaveDocumentAttachment,
  SaveImageAttachment,
  StoredDocumentAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId } from './brand.ts'
export { AttachmentError, isDocumentAdmissionError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, DocumentAdmissionErrorCode, ImageAdmissionErrorCode } from './error.ts'
export type {
  AttachmentRef,
  AttachmentId as AttachmentIdType,
  DocumentAttachmentLimits,
  DocumentAttachmentRef,
  DocumentMediaType,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SavedDocumentAttachment,
  SaveDocumentAttachment,
  SaveImageAttachment,
  StoredDocumentAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits
  /** Deployment-resolved Office document policy. */
  readonly documentLimits: DocumentAttachmentLimits = {
    maxDocumentBytes: 0,
    maxDocumentsPerMessage: 0,
    maxMessageDocumentBytes: 0,
    maxExtractedCharacters: 0,
    mediaTypes: [],
  }

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns a durable content-addressed reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and canonical reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /** Validate one Office document without persisting it. */
  validateDocument(_input: SaveDocumentAttachment): Promise<{ text: string; truncated: boolean }> {
    return Promise.reject(new AttachmentError('Office document attachments are not supported by this store.', 'UNSUPPORTED_DOCUMENT_TYPE'))
  }

  /** Validate and durably save an ordered Office document batch. */
  async saveDocuments(inputs: readonly SaveDocumentAttachment[]): Promise<readonly SavedDocumentAttachment[]> {
    const { maxDocumentsPerMessage, maxMessageDocumentBytes, mediaTypes } = this.documentLimits
    if (inputs.length > maxDocumentsPerMessage) {
      throw new AttachmentError('Document batch exceeds the configured document-count limit.', 'TOO_MANY_DOCUMENTS')
    }
    if (inputs.reduce((sum, input) => sum + input.data.byteLength, 0) > maxMessageDocumentBytes) {
      throw new AttachmentError('Document batch exceeds the configured aggregate byte limit.', 'DOCUMENTS_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Document type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_DOCUMENT_TYPE')
      }
    }
    for (const input of inputs) await this.validateDocument(input)
    const saved: SavedDocumentAttachment[] = []
    for (const input of inputs) saved.push(await this.saveDocument(input))
    return saved
  }

  /** Validate, extract, and durably commit one Office document. */
  saveDocument(_input: SaveDocumentAttachment): Promise<SavedDocumentAttachment> {
    return Promise.reject(new AttachmentError('Office document attachments are not supported by this store.', 'UNSUPPORTED_DOCUMENT_TYPE'))
  }

  /** Read one Office document and verify its immutable reference. */
  readDocument(_ref: DocumentAttachmentRef, _signal?: AbortSignal): Promise<StoredDocumentAttachment> {
    return Promise.reject(new AttachmentError('Office document attachments are not supported by this store.', 'ATTACHMENT_NOT_FOUND'))
  }
}

export default AttachmentStore
