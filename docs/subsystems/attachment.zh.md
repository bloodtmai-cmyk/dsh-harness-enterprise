# 持久图片附件

[English](attachment.md) | 中文

附件 seam 将二进制图片的所有权与会话日志分离。生产方把经过校验的编码字节交给 [`ctx.attachments`](#ctxattachments--attachmentstore-abstract-seam)；只有对象完成持久化后，该服务才会发布不可变的内容寻址引用。会话事件和模型可见的 `ImageBlock` 包含该引用及其元数据，绝不包含浏览器对象 URL、宿主临时路径、提供方 URL 或 base64 数据。

未发送的浏览器草稿可以保留在内存中，原生客户端也可以将其暂存于操作系统临时存储。宿主接受用户消息后，会先把消息中的图片移到 `<DSH_HOME>/attachments/v1` 下，再追加用户事件。结构化模型图片输出遵循同样的先持久化、后追加事件规则。

来源：[`packages/attachment/attachment/src/types.ts`](../../packages/attachment/attachment/src/types.ts)

## 标识与经过校验的元数据

`AttachmentId` 是带类型标记的不透明字符串。本地后端目前生成 `sha256:<digest>`，但消费方既不能解析这种表示，也不能据此派生文件系统路径。

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

引用记录固有尺寸和编码长度，使客户端无需先解码即可排布历史记录；每次权威读取仍会根据对象重新校验摘要、媒体签名、尺寸和元数据。

## 提交与经校验读取的数据

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

`saveImage()` 校验字节并以原子方式提交一个对象，之后才返回其引用。`validateImage()` 执行相同的准入检查，但不持久化任何内容；批量调用方会在保存任何成员前通过它校验所有成员，因此校验拒绝不会留下部分对象。`readImage()` 接受来自已授权会话路径的引用，只在完整性校验通过后返回字节。该服务刻意不规定保留策略：恢复和 fork 后的会话可能共享对象，因此基于引用的垃圾回收会延期实现，而不是与任何一个会话的删除绑定。

## Office 文档附件

Office 文档引用与图片共用不可变内容存储。校验在发布前提取有界纯文本；读取时核对摘要、长度和 OOXML 包类型。基础附件服务以零限额和空媒体类型列表禁用文档；仅支持图片的提供方仍可提供图片策略和会话历史。

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
