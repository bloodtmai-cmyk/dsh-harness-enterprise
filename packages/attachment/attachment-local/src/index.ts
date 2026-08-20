/** Local durable attachment backend rooted below `DSH_HOME`. @module @deepseek-ai/dsh-attachment-local */

import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
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
} from '@deepseek-ai/dsh-attachment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { extractOfficeDocument, readDocumentFile, saveDocumentFile } from './document.ts'
import { readImageFile, saveImageFile, validateImageFile } from './store.ts'

export { detectImage } from './image.ts'
export { extractOfficeDocument, readDocumentFile, saveDocumentFile } from './document.ts'
export { readImageFile, saveImageFile, validateImageFile } from './store.ts'

/** Default maximum encoded bytes for one image. */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Default maximum images in one prompt. */
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20
/** Default maximum aggregate image bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 100 * 1024 * 1024
/** Default maximum intrinsic pixels for one image. */
export const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000
/** Default maximum encoded bytes for one Office document. */
export const DEFAULT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
/** Default maximum Office documents in one prompt. */
export const DEFAULT_MAX_DOCUMENTS_PER_MESSAGE = 5
/** Default maximum aggregate Office document bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES = 50 * 1024 * 1024
/** Default maximum extracted characters retained for one Office document. */
export const DEFAULT_MAX_EXTRACTED_CHARACTERS = 200_000

/** Local attachment backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum encoded bytes accepted for one image. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one image. */
  maxImagePixels?: number
  /** Maximum encoded bytes accepted for one Office document. */
  maxDocumentBytes?: number
  /** Maximum Office document count accepted in one submitted message. */
  maxDocumentsPerMessage?: number
  /** Maximum aggregate Office document bytes in one submitted message. */
  maxMessageDocumentBytes?: number
  /** Maximum extracted plain-text characters retained per document. */
  maxExtractedCharacters?: number
}

/** Persistent content-addressed local attachment store. */
export class LocalAttachmentStore extends AttachmentStore {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
    maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
    maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    maxDocumentBytes: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_BYTES),
    maxDocumentsPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENTS_PER_MESSAGE),
    maxMessageDocumentBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES),
    maxExtractedCharacters: z.number().step(1).min(1).default(DEFAULT_MAX_EXTRACTED_CHARACTERS),
  })

  /** Absolute versioned storage root. */
  readonly root: string
  readonly imageLimits: ImageAttachmentLimits
  override readonly documentLimits: DocumentAttachmentLimits

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = resolve(join(resolveDshHome(config.dshHome), 'attachments', 'v1'))
    this.imageLimits = Object.freeze({
      maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
      mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
    })
    this.documentLimits = Object.freeze({
      maxDocumentBytes: config.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
      maxDocumentsPerMessage: config.maxDocumentsPerMessage ?? DEFAULT_MAX_DOCUMENTS_PER_MESSAGE,
      maxMessageDocumentBytes: config.maxMessageDocumentBytes ?? DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES,
      maxExtractedCharacters: config.maxExtractedCharacters ?? DEFAULT_MAX_EXTRACTED_CHARACTERS,
      mediaTypes: Object.freeze([
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ] as const),
    })
  }

  async validateImage(input: SaveImageAttachment): Promise<void> {
    await validateImageFile(input, this.imageLimits)
  }

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return saveImageFile(this.root, input, this.imageLimits)
  }

  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    return readImageFile(this.root, ref, signal)
  }

  override async validateDocument(input: SaveDocumentAttachment): Promise<{ text: string; truncated: boolean }> {
    return extractOfficeDocument(input, this.documentLimits)
  }

  override async saveDocument(input: SaveDocumentAttachment): Promise<SavedDocumentAttachment> {
    return saveDocumentFile(this.root, input, this.documentLimits)
  }

  override async readDocument(ref: DocumentAttachmentRef, signal?: AbortSignal): Promise<StoredDocumentAttachment> {
    return readDocumentFile(this.root, ref, signal)
  }
}

export default LocalAttachmentStore
