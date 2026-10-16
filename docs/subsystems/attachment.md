# Durable Image Attachments

English | [中文](attachment.zh.md)

The attachment seam separates binary image ownership from the session log. A producer gives validated encoded bytes to [`ctx.attachments`](#ctxattachments--attachmentstore-abstract-seam); the service publishes an immutable content-addressed reference only after the object is durable. Session events and model-visible `ImageBlock`s contain that reference and metadata, never a browser object URL, host temporary path, provider URL, or base64 payload.

Unsent browser drafts may stay in memory and native clients may stage them in operating-system temporary storage. Once the host accepts a user message, its images move below `<DSH_HOME>/attachments/v1` before the user event is appended. Structured model image output follows the same persist-before-event rule.

Source: [`packages/attachment/attachment/src/types.ts`](../../packages/attachment/attachment/src/types.ts)

## Identity and verified metadata

`AttachmentId` is a branded opaque string. The local backend currently emits `sha256:<digest>`, but consumers must neither parse that representation nor derive a filesystem path from it.

```ts type-equiv
/** Raster image formats accepted by the version-one attachment path. */
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
```

```ts type-equiv
/** Durable, serializable metadata for one immutable image object. */
interface ImageAttachmentRef {
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
```

```ts type-equiv
/** Deployment-resolved limits used by upload admission and request buffering. */
interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}
```

The reference records intrinsic dimensions and encoded length so clients can lay out history without decoding first, while every authoritative read still re-checks digest, media signature, dimensions, and metadata against the object.

## Commit and verified-read payloads

```ts type-equiv
/** Request to validate and durably commit one image. */
interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Stored image bytes returned after reference and digest verification. */
interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}
```

`saveImage()` validates bytes and atomically commits one object before returning its reference. `validateImage()` runs the same admission checks without persisting anything; batch callers validate every member through it before saving any member, so validation rejection leaves no partial objects behind. `readImage()` accepts a reference from an authorized session path and returns bytes only after integrity verification. The service is deliberately retention-neutral: resumed and forked sessions may share objects, so reference-aware garbage collection is deferred rather than tied to any one session's deletion.

## Office document attachments

Office references use the same immutable content store as images. Validation extracts bounded plain text before publication; reads verify the digest, length, and OOXML package type. The base attachment service disables documents with zero limits and an empty media-type list; image-only providers still serve their image policy and session history.

```ts type-equiv
/** Modern Office Open XML formats accepted by the document attachment path. */
type DocumentMediaType =
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
```

```ts type-equiv
/** Durable metadata for one immutable Office document. */
interface DocumentAttachmentRef {
  /** Opaque content-addressed identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified against the OOXML package structure. */
  mediaType: DocumentMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Display name stripped of local path information. */
  name: string
}
```

```ts type-equiv
/** Durable attachment reference accepted by the authenticated read endpoint. */
type AttachmentRef = ImageAttachmentRef | DocumentAttachmentRef
```

```ts type-equiv
/** Deployment-resolved Office document admission and extraction limits. */
interface DocumentAttachmentLimits {
  maxDocumentBytes: number
  maxDocumentsPerMessage: number
  maxMessageDocumentBytes: number
  maxExtractedCharacters: number
  mediaTypes: readonly DocumentMediaType[]
}
```

```ts type-equiv
/** Request to validate, extract, and durably commit one Office document. */
interface SaveDocumentAttachment {
  data: Uint8Array
  mediaType: DocumentMediaType
  name: string
}
```

```ts type-equiv
/** Stored Office bytes returned after reference and digest verification. */
interface StoredDocumentAttachment {
  ref: DocumentAttachmentRef
  data: Uint8Array
}
```

```ts type-equiv
/** Validated document payload committed together with its model-visible text. */
interface SavedDocumentAttachment {
  ref: DocumentAttachmentRef
  text: string
  truncated: boolean
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxattachments--attachmentstore-abstract-seam"></a>

### `ctx.attachments` — `AttachmentStore` (abstract seam)

Immutable binary attachment service. Implementations validate bytes before publishing a reference.

```ts cordis-catalog
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
async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>

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

/**
 * Validate one Office document without persisting it.
 * @param _input - encoded document, declared media type, and display name.
 * @returns extracted text and whether the configured text limit truncated it.
 * @throws an unsupported-document error when the provider has no document support.
 */
validateDocument(_input: SaveDocumentAttachment): Promise<{ text: string; truncated: boolean }>

/**
 * Validate every member before saving an ordered Office document batch.
 * @param inputs - documents in their owning message order.
 * @returns durable references and extracted text in input order; no partial result on failure.
 */
async saveDocuments(inputs: readonly SaveDocumentAttachment[]): Promise<readonly SavedDocumentAttachment[]>

/**
 * Validate, extract, and durably commit one Office document.
 * @param _input - encoded document, declared media type, and display name.
 * @returns a durable reference and bounded extracted text.
 * @throws an unsupported-document error when the provider has no document support.
 */
saveDocument(_input: SaveDocumentAttachment): Promise<SavedDocumentAttachment>

/**
 * Read one Office document and verify its immutable reference.
 * @param _ref - immutable reference recorded in the owning session.
 * @param _signal - optional cancellation for storage reads.
 * @returns verified bytes with their original reference.
 * @throws an attachment-not-found error when the provider has no document support.
 */
readDocument(_ref: DocumentAttachmentRef, _signal?: AbortSignal): Promise<StoredDocumentAttachment>
```

Source: [`packages/attachment/attachment/src/index.ts:43`](../../packages/attachment/attachment/src/index.ts)
<!-- END GENERATED cordis-surface -->
