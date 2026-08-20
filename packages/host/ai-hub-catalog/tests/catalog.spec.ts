import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AiHubCatalogGateway, { parseAiHubCatalog } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const catalog = {
  available: true,
  evaluatedAt: '2026-08-17T08:00:00Z',
  mcps: [{
    mcp: { id: 'mcp-1', type: 'MCP', externalRef: 'workbuddy', name: 'WorkBuddy', releaseVersion: '1.0.0' },
    tools: [{ id: 'tool-1', type: 'TOOL', externalRef: 'inventory', name: '库存查询', releaseVersion: '1.0.0' }],
  }],
  skills: [{ id: 'skill-1', type: 'SKILL', externalRef: 'stock', name: '库存助手', releaseVersion: '1.0.0' }],
  bundles: [{
    bundle: { id: 'bundle-1', type: 'BUNDLE', externalRef: 'stock-bundle', name: '库存套件', releaseVersion: '1.0.0' },
    members: [{ id: 'skill-1', type: 'SKILL', externalRef: 'stock', name: '库存助手', releaseVersion: '1.0.0' }],
  }],
  plugins: [],
  instructions: [{ id: 'instruction-1', type: 'INSTRUCTION', externalRef: 'enterprise-baseline', name: '企业基线', releaseVersion: '1.0.0' }],
}

describe('AI Hub catalog Remote', () => {
  it('returns an unavailable empty snapshot outside the managed desktop', () => {
    expect(parseAiHubCatalog(undefined)).toEqual({
      available: false,
      mcps: [],
      skills: [],
      bundles: [],
      plugins: [],
      instructions: [],
      evaluatedAt: null,
    })
  })

  it('rejects malformed snapshots', () => {
    expect(() => parseAiHubCatalog('{')).toThrow('not valid JSON')
    expect(() => parseAiHubCatalog(JSON.stringify({ available: true }))).toThrow('does not match')
  })

  it('publishes the startup snapshot through one direct list method', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_AI_HUB_CATALOG: JSON.stringify(catalog) } },
    ]))
    await ctx.plugin(AiHubCatalogGateway)
    const gateway = ctx.get('aiHubCatalog') as AiHubCatalogGateway

    expect(remoteMethods(gateway)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'entitlements', invocation: { kind: 'direct' } },
      { method: 'market', invocation: { kind: 'direct' } },
      { method: 'request', invocation: { kind: 'direct' } },
    ])
    expect(gateway.list()).toEqual(catalog)
    await expect(gateway.entitlements()).resolves.toEqual({ available: false, menus: [] })
  })
})
