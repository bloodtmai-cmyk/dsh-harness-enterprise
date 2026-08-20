import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  LOCALE_SETTINGS_NAMESPACE, OUTPUT_LANGUAGE_FROM_LOCALE_ENV, apply,
} from '@deepseek-ai/dsh-client-locale'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('locale host', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('registers an optional explicit locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { preference: 'en' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'en' })
    await expect(ctx.settings.update(ns, { preference: 'fr' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('uses the current locale for each managed-desktop prompt assembly', async () => {
    vi.stubEnv(OUTPUT_LANGUAGE_FROM_LOCALE_ENV, '1')
    vi.stubEnv('DSH_DESKTOP_LANGUAGE', 'zh')
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt, { persona: '' }).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Use Simplified Chinese for all natural-language output')

    await ctx.settings.update(ns, { preference: 'en' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Use English for all natural-language output')
  })
})
