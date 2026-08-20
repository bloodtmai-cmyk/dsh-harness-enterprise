/**
 * Managed OpenAI-compatible adapter. The gateway's model listing is
 * the only model authority; no settings namespace or configurable-provider
 * directory is exposed.
 * @module @deepseek-ai/dsh-llm-openai-compatible-managed
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { discoverModels, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/profiles'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used in loader diagnostics. */
export const name = 'llm-openai-compatible-managed'
/** The adapter registry must exist before the managed route mounts. */
export const inject = ['llm']

const PROVIDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/

/** Immutable deployment configuration for the managed gateway route. */
export interface Config {
  /** Harness provider route. */
  provider: string
  /** User-facing provider label. */
  displayName: string
  /** Environment reference for the OpenAI-compatible API root. */
  baseURLEnv: string
  /** Credential reference resolved per request. */
  apiKeyEnv: string
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  provider: z.string().required().pattern(PROVIDER_PATTERN).default('managed'),
  displayName: z.string().required().default('Managed Model Gateway'),
  baseURLEnv: z.string().required().pattern(ENV_NAME_PATTERN).default('MODEL_GATEWAY_BASE_URL'),
  apiKeyEnv: z.string().required().default('MODEL_GATEWAY_API_KEY'),
})

function checkedBaseURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error(`llm-openai-compatible-managed: baseURL is not a valid URL: ${value}`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`llm-openai-compatible-managed: baseURL must use http or https, received ${url.protocol}`)
  }
  return value.replace(/\/+$/, '')
}

async function resolveApiKey(ctx: Context, refName: string): Promise<string> {
  const ref = credentialRef(refName)
  const credentials = ctx.get('credentials')
  const stored = credentials === undefined
    ? launchEnvironmentOf(ctx).get(refName)?.value
    : (await credentials.resolve(ref))?.value
  if (stored === undefined || stored.length === 0) {
    throw new LlmError(
      `llm-openai-compatible-managed: no credential resolved from ${refName}; set it in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  return assertUsableApiKey(stored, 'llm-openai-compatible-managed', refName)
}

/**
 * Discover the gateway catalog once, then register exactly that immutable
 * route for this process. Credential values remain per-request reads.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const configuredBaseURL = launchEnvironmentOf(ctx).get(config.baseURLEnv)?.value
  if (configuredBaseURL === undefined || configuredBaseURL.length === 0) {
    throw new Error(`llm-openai-compatible-managed: no endpoint resolved from ${config.baseURLEnv}`)
  }
  const baseURL = checkedBaseURL(configuredBaseURL)
  const initialKey = await resolveApiKey(ctx, config.apiKeyEnv)
  const discovered = await discoverModels({
    baseURL,
    api: 'openai-completions',
    apiKey: initialKey,
  })
  const seen = new Set<string>()
  for (const model of discovered) {
    if (seen.has(model.id)) {
      throw new Error(`llm-openai-compatible-managed: model gateway returned duplicate model id "${model.id}"`)
    }
    seen.add(model.id)
  }
  if (discovered.length === 0) {
    throw new Error('llm-openai-compatible-managed: model gateway returned no usable models')
  }

  const profiles = resolveProfiles({
    [config.provider]: {
      displayName: config.displayName,
      apiKeyEnv: config.apiKeyEnv,
      api: 'openai-completions',
      baseURL,
      models: discovered.map(model => ({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      })),
    },
  })
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => resolveApiKey(ctx, config.apiKeyEnv),
  })
  ctx.llm.registerAdapter([config.provider], adapter)
  ctx.logger.info(`llm-openai-compatible-managed: registered ${discovered.length} model(s) from ${baseURL}`)
}
