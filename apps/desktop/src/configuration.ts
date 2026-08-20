import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { MANAGED_WORKBUDDY_MCP_URL } from './workbuddy-oauth.ts'

const MAX_MODEL_RESPONSE_BYTES = 4 * 1024 * 1024
export const DEFAULT_MODEL_GATEWAY_BASE_URL = 'http://127.0.0.1:4000/v1'
export const MANAGED_AI_HUB_BASE_URL = 'http://127.0.0.1:8090/ai-hub'

export interface DesktopConfig {
  modelGatewayBaseURL: string
  modelApiKey: string
  preferredModel?: string
  workspace?: string
  mcp: {
    url: string
    serverName: string
  }
}

export async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(path, 'utf8')) as Record<string, string>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`无法读取环境配置 ${path}: ${String(error)}`, { cause: error })
  }
}

/** Merge most-trusted first without letting a fallback overwrite it. */
export function mergeEnvironment(...layers: ReadonlyArray<Readonly<Record<string, string | undefined>>>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {}
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      if (value !== undefined && merged[name] === undefined) merged[name] = value
    }
  }
  return merged
}

export function normalizeOpenAiBaseURL(raw: string): string {
  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error('模型网关地址不是有效 URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('模型网关地址只允许 http 或 https')
  }
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1'
  return url.toString().replace(/\/$/, '')
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

export function loadDesktopConfig(
  env: NodeJS.ProcessEnv,
  rawApiKey: string,
  rawBaseURL: string = DEFAULT_MODEL_GATEWAY_BASE_URL,
): DesktopConfig {
  const preferredModel = optional(env.MODEL_GATEWAY_DEFAULT_MODEL) ?? optional(env.LITELLM_DEFAULT_MODEL)
  const workspace = optional(env.DSH_DESKTOP_WORKSPACE)
  const apiKey = optional(rawApiKey)
  if (apiKey === undefined) throw new Error('模型 API Key 不能为空')
  const config: DesktopConfig = {
    modelGatewayBaseURL: normalizeOpenAiBaseURL(rawBaseURL),
    modelApiKey: apiKey,
    mcp: {
      url: optional(env.WORKBUDDY_MCP_URL) ?? optional(env.DSH_DESKTOP_MCP_URL) ?? MANAGED_WORKBUDDY_MCP_URL,
      serverName: optional(env.WORKBUDDY_MCP_NAME) ?? optional(env.DSH_DESKTOP_MCP_NAME) ?? 'enterprise-gateway',
    },
    ...preferredModel === undefined ? {} : { preferredModel },
    ...workspace === undefined ? {} : { workspace },
  }
  return config
}

export async function discoverOpenAiCompatibleModels(baseURL: string, apiKey: string): Promise<string[]> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new Error(`无法连接模型网关: ${url}`, { cause: error })
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`模型网关检查失败: HTTP ${response.status}`)
  }
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_MODEL_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('模型列表超过 4 MiB')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_MODEL_RESPONSE_BYTES) throw new Error('模型列表超过 4 MiB')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    throw new Error('模型网关 /models 没有返回有效 JSON', { cause: error })
  }
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new Error('模型网关 /models 响应缺少 data 数组')
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of data) {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  if (result.length === 0) throw new Error('模型网关没有返回可用模型')
  return result
}

export function selectDefaultModel(models: readonly string[], preferred?: string): string {
  if (preferred !== undefined) {
    if (!models.includes(preferred)) throw new Error(`默认模型不在模型网关返回的列表中: ${preferred}`)
    return preferred
  }
  if (models.includes('deepseek-v4-flash')) return 'deepseek-v4-flash'
  const first = models[0]
  if (first === undefined) throw new Error('模型网关没有返回可用模型')
  return first
}
