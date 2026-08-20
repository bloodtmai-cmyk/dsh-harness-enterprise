/** Read-only Remote projection of the AI Hub catalog sampled at desktop launch. */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { AiHubCatalogSnapshot, AiHubMarketSnapshot, AiHubMenuEntitlements } from './types.ts'

export type * from './types.ts'

const ENV_NAME = 'DSH_AI_HUB_CATALOG'
const MAX_CATALOG_BYTES = 1024 * 1024

const capabilitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['MCP', 'TOOL', 'SKILL', 'BUNDLE', 'CLIENT_PLUGIN', 'INSTRUCTION']),
  externalRef: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  releaseVersion: z.string().min(1),
  integrityHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

const catalogSchema = z.object({
  available: z.boolean(),
  mcps: z.array(z.object({ mcp: capabilitySchema, tools: z.array(capabilitySchema) })),
  skills: z.array(capabilitySchema),
  bundles: z.array(z.object({ bundle: capabilitySchema, members: z.array(capabilitySchema) })),
  plugins: z.array(capabilitySchema).default([]),
  instructions: z.array(capabilitySchema).default([]),
  evaluatedAt: z.string().nullable(),
})

const menuEntitlementsSchema = z.object({ menus: z.array(z.enum(['PLUGIN_MARKET'])) })

const unavailableCatalog: AiHubCatalogSnapshot = {
  available: false,
  mcps: [],
  skills: [],
  bundles: [],
  plugins: [],
  instructions: [],
  evaluatedAt: null,
}

/**
 * Parse the desktop-projected catalog without exposing Hub credentials to the child host.
 * @param raw - serialized `DSH_AI_HUB_CATALOG` value.
 * @returns validated client-safe startup snapshot.
 */
export function parseAiHubCatalog(raw: string | undefined): AiHubCatalogSnapshot {
  if (raw === undefined || raw.length === 0) return unavailableCatalog
  if (Buffer.byteLength(raw, 'utf8') > MAX_CATALOG_BYTES) {
    throw new Error(`${ENV_NAME} exceeds 1 MiB`)
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${ENV_NAME} is not valid JSON`, { cause: error })
  }
  const parsed = catalogSchema.safeParse(value)
  if (!parsed.success) throw new Error(`${ENV_NAME} does not match the AI Hub catalog contract`)
  return parsed.data
}

/** Trusted Remote service for the browser AI Hub market contribution. */
export class AiHubCatalogGateway extends TypertRemoteService {
  private readonly snapshot: AiHubCatalogSnapshot
  private readonly hubBaseURL: string | undefined
  private readonly brokerURL: string | undefined
  private readonly brokerSecret: string | undefined

  constructor(ctx: Context) {
    super(ctx, 'aiHubCatalog')
    const environment = launchEnvironmentOf(ctx)
    this.snapshot = parseAiHubCatalog(environment.get(ENV_NAME)?.value)
    this.hubBaseURL = environment.get('DSH_AI_HUB_BASE_URL')?.value.replace(/\/+$/, '')
    this.brokerURL = environment.get('DSH_DESKTOP_MCP_BROKER_URL')?.value
    this.brokerSecret = environment.get('DSH_DESKTOP_MCP_BROKER_SECRET')?.value
  }

  /**
   * Return the immutable catalog sampled before the local Harness host started.
   * @returns validated startup catalog snapshot.
   */
  @Remote('list')
  list(): AiHubCatalogSnapshot {
    return this.snapshot
  }

  /**
   * Resolve live menu access without exposing the user's AI Hub token to the renderer.
   * @returns current typed menu entitlement result.
   */
  @Remote('entitlements')
  async entitlements(): Promise<AiHubMenuEntitlements> {
    if (!this.hasLiveHub()) return { available: false, menus: [] }
    const payload = await this.hubJson('/api/client/menu-entitlements')
    const parsed = menuEntitlementsSchema.safeParse(payload)
    if (!parsed.success) throw new Error('AI Hub menu entitlements do not match the client contract')
    return { available: true, menus: parsed.data.menus }
  }

  /**
   * Fetch the complete published market and the current user's application state.
   * @returns live market snapshot with an evaluation timestamp.
   */
  @Remote('market')
  async market(): Promise<AiHubMarketSnapshot> {
    if (!this.hasLiveHub()) return { available: false, items: [], evaluatedAt: null }
    const items = await this.hubJson<AiHubMarketSnapshot['items']>('/api/client/capability-market')
    return { available: true, items, evaluatedAt: new Date().toISOString() }
  }

  /**
   * Submit one request without exposing either credential to the renderer.
   * @param capabilityId - published capability UUID.
   * @param reason - user-provided business reason.
   * @returns after AI Hub accepts the application.
   */
  @Remote('request')
  async request(capabilityId: string, reason: string): Promise<void> {
    if (!this.hasLiveHub()) throw new Error('AI Hub is unavailable')
    await this.hubJson('/api/client/capability-market/applications', {
      method: 'POST',
      body: JSON.stringify({ capabilityId, reason }),
    })
  }

  private hasLiveHub(): boolean {
    return this.hubBaseURL !== undefined && this.brokerURL !== undefined && this.brokerSecret !== undefined
  }

  private async hubJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.hasLiveHub()) throw new Error('AI Hub is unavailable')
    const hubBaseURL = this.hubBaseURL
    const brokerURL = this.brokerURL
    const brokerSecret = this.brokerSecret
    if (hubBaseURL === undefined || brokerURL === undefined || brokerSecret === undefined) {
      throw new Error('AI Hub is unavailable')
    }
    const tokenResponse = await fetch(brokerURL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${brokerSecret}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!tokenResponse.ok) throw new Error('AI Hub credential broker is unavailable')
    const token = await tokenResponse.json() as { accessToken?: unknown }
    if (typeof token.accessToken !== 'string' || token.accessToken.length === 0) {
      throw new Error('AI Hub credential broker returned an invalid token')
    }
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token.accessToken}`)
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${hubBaseURL}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      let message = `AI Hub request failed (${response.status})`
      try {
        const problem = await response.json() as { message?: unknown }
        if (typeof problem.message === 'string') message = problem.message
      } catch { /* keep the status-based message */ }
      throw new Error(message)
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }
}

export default AiHubCatalogGateway
