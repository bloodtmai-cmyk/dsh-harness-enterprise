// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import {
  EnterpriseMarketRoot,
  ManagedUpdateAction,
  type EnterpriseMarketInjected,
} from '../src/client/EnterpriseMarketRoot.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const entitlements = vi.fn().mockResolvedValue({ ok: true, value: { available: true, menus: ['PLUGIN_MARKET'] } })
  const market = vi.fn().mockResolvedValue({ ok: true, value: { available: true, items: [], evaluatedAt: null } })
  const request = vi.fn().mockResolvedValue({ ok: true, value: undefined })
  ctx.provide('remote.aiHubCatalog', { entitlements, market, request })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, entitlements, market, request }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'sidebar.settings.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-ai-hub browser plugin', () => {
  it('registers the market in the sidebar and keeps Hub credentials behind the Remote', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('sidebar.footer.action')[0]!
    expect(entry.component).toBe(EnterpriseMarketRoot)
    expect(entry.options).toMatchObject({ id: 'ai-hub-market', order: 10 })
    const updateEntry = b.slots.entries('sidebar.settings.action')[0]!
    expect(updateEntry.component).toBe(ManagedUpdateAction)
    expect(updateEntry.options).toMatchObject({ id: 'managed-updates', order: 10 })
    const injected = (entry.inject as unknown as () => EnterpriseMarketInjected)()
    await expect(injected.entitlements()).resolves.toEqual({ available: true, menus: ['PLUGIN_MARKET'] })
    await expect(injected.market()).resolves.toEqual({ available: true, items: [], evaluatedAt: null })
    await injected.request('capability-1', '业务用途')
    expect(b.entitlements).toHaveBeenCalledOnce()
    expect(b.market).toHaveBeenCalledOnce()
    expect(b.request).toHaveBeenCalledWith('capability-1', '业务用途')
    await b.ctx.fiber.dispose()
  })

  it('tracks late sidebar declaration and disposal', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('sidebar.settings.action')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1) })
    expect(b.slots.entries('sidebar.settings.action')).toHaveLength(1)
    stop()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('sidebar.settings.action')).toHaveLength(0)

    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('sidebar.footer.action')[0]?.component).toBe(EnterpriseMarketRoot) })
    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('sidebar.settings.action')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
