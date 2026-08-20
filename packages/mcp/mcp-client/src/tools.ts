/**
 * Tool bridge: discovers MCP tools, registers them on the harness ToolRuntime
 * under deterministic server-qualified public names, and handles re-sync when
 * the server's tool list changes.
 *
 * Naming contract (see the mcp-client Agent Note "Naming invariants"): every MCP tool
 * has the stable identity `(serverName, rawName)`; the model-facing public name
 * is `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
 * constraints. The raw name is only ever sent on the wire (`tools/call`); the
 * public name is never parsed to recover it.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ChartBlock, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, JsonValue } from '@deepseek-ai/dsh-tools'

/** Resolved options relevant to tool bridging. */
export interface ToolBridgeOptions {
  /** JSON envelope error codes that should be promoted to failed tool results. */
  jsonErrorMessages?: Readonly<Record<string, string>>
  /** Whether a registry conflict is contained or rejects this synchronization. */
  registrationFailure: 'contain' | 'throw'
  serverName: string
  toolCallTimeoutMs: number
  /** Deployment-owned guidance appended to every model-facing tool description. */
  toolGuidance?: string
  /** Include only the opaque Harness session id for a trusted enterprise Gateway. */
  includeSessionMeta?: boolean
}

/** State for one sync generation: the current set of disposers keyed by public name. */
export type ToolDisposers = Map<string, () => void>

/** Canonical MCP result exposed to Code Mode without discarding protocol blocks. */
export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  meta?: JsonValue
  structuredContent?: Structured
}

/**
 * DeepSeek function-name contract: at most 64 characters. Wire-protocol
 * constant, not configuration.
 */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** Raw result record: the bridge owns JSON-value validation after transport. */
const RawCallToolResultSchema = z.record(z.string(), z.unknown())

/** Prevent a rich MCP result from turning one session event into a huge UI payload. */
const MAX_CHART_PAYLOAD_BYTES = 1024 * 1024

/** GPT-Vis 1.0 chart vocabulary supported by the renderer. */
const CHART_TYPES = new Set([
  'area', 'bar', 'boxplot', 'column', 'dual-axes', 'fishbone-diagram',
  'flow-diagram', 'funnel', 'histogram', 'indented-tree', 'line', 'liquid',
  'mindmap', 'network-graph', 'organization-chart', 'pie', 'radar', 'sankey',
  'scatter', 'summary', 'table', 'treemap', 'venn', 'violin', 'waterfall',
  'word-cloud',
])

/** Raster formats supported by the durable attachment vocabulary. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** List without mutating the SDK's per-page output-validator cache. */
function listToolsUncached(client: Client, cursor?: string) {
  return client.request(
    { method: 'tools/list', ...cursor === undefined ? {} : { params: { cursor } } },
    ListToolsResultSchema,
  )
}

/** Call without the SDK pre-validating an output schema the bridge may not support. */
function callToolUncached(
  client: Client,
  rawName: string,
  args: Record<string, unknown>,
  exec: ToolExecution,
  opts: ToolBridgeOptions,
) {
  return client.request(
    {
      method: 'tools/call',
      params: {
        name: rawName,
        arguments: args,
        ...(opts.includeSessionMeta && exec.agent !== undefined
          ? { _meta: { session_id: String(exec.agent.id) } }
          : {}),
      },
    },
    RawCallToolResultSchema,
    {
      signal: exec.signal,
      timeout: opts.toolCallTimeoutMs,
    },
  )
}

/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Deterministic pure function of `(serverName, rawName)`: the clean case is
 * `mcp__<serverName>__<rawName>` verbatim. When character replacement or
 * truncation to the DeepSeek function-name contract (64 chars,
 * `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
 * identity is appended so distinct MCP identities never collapse into the
 * same public name.
 *
 * @param serverName - Stable local namespace from plugin config.
 * @param rawName - The MCP server's own tool name.
 * @returns The globally unique, model-facing ToolRuntime name.
 */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 *
 * 1. Fetch: drain uncached `tools/list` pagination and build the full next
 *    generation of `ToolDefinition`s under public names. Any failure here
 *    (network error, duplicate raw name in the server's list) rejects and
 *    leaves the previous generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict here can only mean a foreign registration squats on this
 *    server's `mcp__<serverName>__` namespace — the partial generation is
 *    rolled back (zero tools from this server) and logged. Initial strict
 *    synchronization may propagate the conflict so its parent transaction
 *    rejects; ordinary clients and later re-syncs return an empty map.
 *
 * @param client - Connected MCP Client instance used to list and call tools.
 * @param ctx - Cordis context providing the `tools` service for registration.
 * @param opts - Bridge options: server namespace and per-call timeout.
 * @param previous - Disposer map from the prior sync generation; disposed
 *   during the swap phase (only after the fetch phase succeeded).
 * @returns A map of registered public tool names to their unregister
 *   disposers — the exact set of live registrations owned by this server.
 */
export async function syncTools(
  client: Client,
  ctx: Context,
  opts: ToolBridgeOptions,
  previous: ToolDisposers,
): Promise<ToolDisposers> {
  // Phase 1: fetch and build the next generation without touching the registry.
  const definitions = new Map<string, ToolDefinition>()
  let cursor: string | undefined
  do {
    const response = await listToolsUncached(client, cursor)
    for (const tool of response.tools) {
      const publicName = publicToolName(opts.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(
          `mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
        )
      }
      definitions.set(publicName, createDefinition(
        client,
        ctx,
        publicName,
        tool.name,
        appendToolGuidance(tool.description ?? '', opts.toolGuidance),
        tool.inputSchema,
        supportedOutputSchema(tool.outputSchema),
        tool.execution?.taskSupport === 'required',
        opts,
      ))
    }
    cursor = response.nextCursor
  } while (cursor)

  // Phase 2: swap generations.
  for (const dispose of previous.values()) dispose()
  const disposers: ToolDisposers = new Map()
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition))
    }
  } catch (error) {
    // A conflict on an `mcp__<serverName>__`-qualified name means a foreign
    // registration occupies this server's namespace. Roll back so the model
    // sees either the full generation or none of it — never a partial set.
    for (const dispose of disposers.values()) dispose()
    ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    if (opts.registrationFailure === 'throw') throw error
    return new Map()
  }
  return disposers
}

/**
 * The shape we read from each MCP content block. Intentionally looser than the
 * SDK's `ContentBlock` type: we're at a network trust boundary (data arrives
 * from an external MCP server process via JSON-RPC), so fields that the SDK
 * declares required may be absent at runtime if the server is buggy.
 */
interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** Async rich projection staged for one exact ToolRuntime execution. */
interface PreparedProjection {
  /** Canonical MCP value returned by execute before registry materialization. */
  value: McpResult
  /** Synchronous output.render projection expected before finalization. */
  fallback: ContentBlock[]
  /** Image-enriched or explicit-refusal projection prepared during execute. */
  content: ContentBlock[]
}

/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Build one generation-local tool definition and its execution-local rich projections.
 * @param client - connected MCP client used for calls.
 * @param ctx - plugin context carrying optional attachment and model services.
 * @param publicName - registry-qualified public tool name.
 * @param rawName - MCP wire tool name.
 * @param description - model-facing tool description.
 * @param parameters - MCP input schema.
 * @param structuredSchema - supported structured-output schema, when advertised.
 * @param taskRequired - whether this MCP tool requires unsupported task execution.
 * @param opts - bridge timeout and namespace options.
 * @returns a complete ToolRuntime definition.
 */
function createDefinition(
  client: Client,
  ctx: Context,
  publicName: string,
  rawName: string,
  description: string,
  parameters: Record<string, unknown>,
  structuredSchema: JsonSchemaNode | undefined,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
): ToolDefinition {
  const projections = new WeakMap<ToolExecution, PreparedProjection>()
  return {
    name: publicName,
    description,
    parameters,
    output: createOutput(rawName, structuredSchema),
    execute: createExecutor(client, ctx, rawName, taskRequired, opts, projections),
    finalizeContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}

/** Build the canonical result schema and existing Native text projection. */
function createOutput(rawName: string, structuredSchema: JsonSchemaNode | undefined): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        meta: {},
        structuredContent: structuredSchema ?? {},
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args: unknown, value: JsonValue) {
      const result = value as unknown as McpResult
      return [{ type: 'text', text: extractText(result.content, rawName) }]
    },
  }
}

/**
 * Create an execute function for one MCP tool. The executor closes over the
 * raw MCP tool name and sends an uncached `tools/call` request with it (never
 * the public name), with abort signal and timeout, then maps the result to
 * harness ContentBlocks. Owning the raw request prevents the SDK's internal
 * per-page schema cache from pre-validating a different contract.
 *
 * When the MCP server returns `isError: true`, the executor throws so that
 * the ToolRuntime's catch path produces an `isError` result for the model.
 */
function createExecutor(
  client: Client,
  ctx: Context,
  rawName: string,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
  projections: WeakMap<ToolExecution, PreparedProjection>,
): ToolDefinition['execute'] {
  return async (args: unknown, exec: ToolExecution) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    }
    // The agent loop passes `JSON.parse(model_arguments)` which is usually an
    // object, but can be any JSON value if the model misbehaves (outputs a bare
    // string/number/null). Fallback to {} lets the MCP server produce a
    // specific "missing required param" error the model can learn from.
    const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    const result = await callToolUncached(client, rawName, argsObj, exec, opts)

    // The SDK may return a legacy `toolResult` shape; normalize to content array.
    if (!Array.isArray(result.content)) {
      const rendered: unknown = 'toolResult' in result
        ? JSON.stringify(result.toolResult)
        : '(no output)'
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      return {
        content: [{ type: 'text', text }],
        ...result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent as JsonValue }
          : {},
      }
    }

    // Trust boundary: the SDK's return type erases to `any[]` due to the
    // union of CallToolResult | CompatibilityCallToolResult; extractText
    // validates each element.
    const content = result.content as unknown as JsonValue[]
    const text = extractText(content, rawName)

    // MCP isError → throw so ToolRuntime produces an isError result for the model.
    if (result.isError === true) {
      throw new Error(text)
    }

    const configuredError = findConfiguredJsonError(content, opts.jsonErrorMessages)
    if (configuredError !== undefined) throw new Error(configuredError)

    const richMeta = chartMeta(result)
    const value: McpResult = {
      content,
      ...richMeta !== undefined ? { meta: richMeta } : {},
      ...result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent as JsonValue }
        : {},
    }
    const chart = chartBlock(result)
    if (containsImage(content) || chart !== undefined) {
      const fallback: ContentBlock[] = [{ type: 'text', text: extractText(content, rawName) }]
      const projected = containsImage(content)
        ? await prepareImageProjection(ctx, exec, content, rawName)
        : fallback
      projections.set(exec, {
        value,
        fallback,
        content: chart === undefined ? projected : [...projected, chart],
      })
    }
    return value
  }
}

/** Recursively narrow untrusted JSON-RPC metadata to the protocol's JSON value set. */
function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (depth >= 32) return false
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.values(value).every(item => isJsonValue(item, depth + 1))
}

/** Read the MCP `_meta` chart envelope while accepting documented adapter aliases. */
function chartMeta(result: Record<string, unknown>): JsonValue | undefined {
  const candidate = result._meta ?? result.meta ?? result.toolMeta
  if (!isJsonValue(candidate) || !isRecord(candidate) || candidate.type !== 'chart') return undefined
  if (typeof candidate.chart_type !== 'string' || !CHART_TYPES.has(candidate.chart_type)) return undefined
  const payload = candidate.payload
  if (payload === undefined || !isRecord(payload)) return undefined
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (bytes === 0 || bytes > MAX_CHART_PAYLOAD_BYTES) return undefined
  return candidate
}

/** Convert one validated MCP chart envelope into durable UI content. */
function chartBlock(result: Record<string, unknown>): ChartBlock | undefined {
  const meta = chartMeta(result)
  if (meta === undefined || !isRecord(meta)) return undefined
  const payload = meta.payload
  if (payload === undefined || !isRecord(payload)) return undefined
  const chartType = meta.chart_type as string
  return {
    type: 'chart',
    chartType,
    payload: {
      ...payload,
      type: chartType,
    },
  }
}

/** Whether an untrusted MCP content array contains a declared image block. */
function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

/** Narrow one JSON value to a string-keyed object. */
function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a declared MIME string to the durable image vocabulary. */
function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

/** Decode one untrusted MCP image block without accepting base64 aliases. */
function decodeImage(block: McpContentBlock): SaveImageAttachment {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (block.data === undefined || !CANONICAL_BASE64.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType }
}

/**
 * Resolve the active model route and durable store for an image-bearing result.
 * @param ctx - plugin context with optional services.
 * @param exec - exact tool execution whose agent supplies the latest route.
 * @returns the attachment store after exact positive image-capability proof.
 */
async function resolveImageAdmission(ctx: Context, exec: ToolExecution): Promise<AttachmentStore> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}

/** Stable diagnostic text for an image block that was not admitted. */
function imageDiagnostic(block: McpContentBlock, reason: string): string {
  const mediaType = block.mimeType ?? 'unknown media type'
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text while retaining the canonical raw
 * value for programmatic callers.
 */
async function prepareImageProjection(
  ctx: Context,
  exec: ToolExecution,
  content: JsonValue[],
  toolName: string,
): Promise<ContentBlock[]> {
  const decoded: SaveImageAttachment[] = []
  const validationErrors = new Map<number, string>()
  const imageIndexes: number[] = []
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      // decodeImage owns every throw above and always produces Error.
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? 'another image in the same result was invalid',
      ),
    }))
  }

  let attachments: AttachmentStore
  try {
    attachments = await resolveImageAdmission(ctx, exec)
  } catch (error: unknown) {
    // resolveImageAdmission contains provider failures and throws Error only.
    const reason = (error as Error).message
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    const refs = await attachments.saveImages(decoded)
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset] as ImageAttachmentRef] as const))
    return projectContent(content, toolName, (_block, index) => ({
      type: 'image',
      attachment: byIndex.get(index) as ImageAttachmentRef,
    }))
  } catch (error: unknown) {
    const reason = isImageAdmissionError(error)
      ? `image admission rejected the result: ${error.message}`
      : 'durable image storage rejected the result'
    return projectContent(content, toolName, block => ({
      type: 'text',
      text: imageDiagnostic(block, reason),
    }))
  }
}

/** Keep deployment policy beside the remote description without changing the wire schema. */
function appendToolGuidance(description: string, guidance: string | undefined): string {
  const normalized = guidance?.trim() ?? ''
  if (normalized === '') return description
  return description === '' ? normalized : `${description}\n\n${normalized}`
}

/**
 * Some enterprise HTTP adapters serialize a business-error envelope into an
 * MCP text block while incorrectly leaving `isError` false. Only explicitly
 * configured codes are promoted; arbitrary JSON tool output remains success.
 */
function findConfiguredJsonError(
  content: JsonValue[],
  messages: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (messages === undefined || Object.keys(messages).length === 0) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    if (value.type !== 'text' || typeof value.text !== 'string') continue
    try {
      const envelope: unknown = JSON.parse(value.text)
      if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) continue
      const code = (envelope as Record<string, unknown>).code
      if (typeof code !== 'string' && typeof code !== 'number') continue
      const message = messages[String(code)]
      if (message !== undefined && message.trim() !== '') return message
    } catch {
      // Ordinary text is the common case; it is not a JSON error envelope.
    }
  }
  return undefined
}

/**
 * Extract text from an MCP content array into a single string.
 * - text blocks: join with '\n'
 * - image/audio/resource blocks: replaced with a placeholder
 *
 * Defensive: fields that the MCP spec declares required (mimeType, text) are
 * guarded with fallbacks because this is a network trust boundary.
 */
function extractText(mcpContent: JsonValue[], toolName: string): string {
  const content = projectContent(mcpContent, toolName)
  // The default image projector below also returns text, so this local call
  // cannot produce a core image block.
  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

/**
 * Project ordered MCP blocks into the core content vocabulary.
 * Text-like runs are newline-coalesced; admitted images split those runs at
 * their original position.
 */
function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context'),
  }),
): ContentBlock[] {
  const projected: ContentBlock[] = []
  const text: string[] = []
  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push('[embedded resource unsupported; raw resource data remains available to programmatic callers]')
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0
    ? projected
    : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
