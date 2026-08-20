/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */

import type { AttachmentId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Modern Office Open XML formats accepted by the document attachment path. */
export type DocumentMediaType =
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** Durable, serializable metadata for one immutable image object. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Durable metadata for one immutable Office document. */
export interface DocumentAttachmentRef {
  /** Opaque content-addressed identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified against the OOXML package structure. */
  mediaType: DocumentMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Display name stripped of local path information. */
  name: string
}

/** Durable attachment reference accepted by the authenticated read endpoint. */
export type AttachmentRef = ImageAttachmentRef | DocumentAttachmentRef

/** Deployment-resolved Office document admission and extraction limits. */
export interface DocumentAttachmentLimits {
  maxDocumentBytes: number
  maxDocumentsPerMessage: number
  maxMessageDocumentBytes: number
  maxExtractedCharacters: number
  mediaTypes: readonly DocumentMediaType[]
}

/** Request to validate, extract, and durably commit one Office document. */
export interface SaveDocumentAttachment {
  data: Uint8Array
  mediaType: DocumentMediaType
  name: string
}

/** Stored Office bytes returned after reference and digest verification. */
export interface StoredDocumentAttachment {
  ref: DocumentAttachmentRef
  data: Uint8Array
}

/** Validated document payload committed together with its model-visible text. */
export interface SavedDocumentAttachment {
  ref: DocumentAttachmentRef
  text: string
  truncated: boolean
}
