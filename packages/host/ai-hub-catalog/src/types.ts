/** Capability kinds assigned by AI Hub. */
export type AiHubCapabilityType = 'MCP' | 'TOOL' | 'SKILL' | 'BUNDLE' | 'CLIENT_PLUGIN' | 'INSTRUCTION'

/** Client-safe metadata for one authorized capability. */
export interface AiHubCapabilityView {
  readonly id: string
  readonly type: AiHubCapabilityType
  readonly externalRef: string
  readonly name: string
  readonly description?: string | undefined
  readonly releaseVersion: string
  readonly integrityHash?: string | undefined
}

/** One authorized MCP and its authorized tools. */
export interface AiHubMcpCatalogItem {
  readonly mcp: AiHubCapabilityView
  readonly tools: readonly AiHubCapabilityView[]
}

/** One directly authorized Bundle and its effective members. */
export interface AiHubBundleCatalogItem {
  readonly bundle: AiHubCapabilityView
  readonly members: readonly AiHubCapabilityView[]
}

/** Immutable AI Hub catalog sampled by the desktop host during startup. */
export interface AiHubCatalogSnapshot {
  readonly available: boolean
  readonly mcps: readonly AiHubMcpCatalogItem[]
  readonly skills: readonly AiHubCapabilityView[]
  readonly bundles: readonly AiHubBundleCatalogItem[]
  readonly plugins: readonly AiHubCapabilityView[]
  readonly instructions: readonly AiHubCapabilityView[]
  readonly evaluatedAt: string | null
}

/** Per-user state of one item visible in the enterprise market. */
export type AiHubMarketState = 'AVAILABLE' | 'PENDING' | 'AUTHORIZED' | 'REJECTED'

/** Latest access application attached to one market entry. */
export interface AiHubCapabilityApplicationView {
  readonly id: string
  readonly reason: string
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED'
  readonly submittedAt: string
  readonly decisionComment?: string | undefined
}

/** One published capability together with its current-user access state. */
export interface AiHubMarketItem {
  readonly capability: AiHubCapabilityView
  readonly state: AiHubMarketState
  readonly latestApplication?: AiHubCapabilityApplicationView | undefined
}

/** Live market response returned through the trusted Host Remote. */
export interface AiHubMarketSnapshot {
  readonly available: boolean
  readonly items: readonly AiHubMarketItem[]
  readonly evaluatedAt: string | null
}

/** AI Hub menu keys understood by this Harness build. */
export type AiHubMenuKey = 'PLUGIN_MARKET'

/** Live menu entitlements resolved from the current WorkBuddy identity. */
export interface AiHubMenuEntitlements {
  readonly available: boolean
  readonly menus: readonly AiHubMenuKey[]
}
