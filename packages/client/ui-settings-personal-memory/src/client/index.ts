import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { PersonalMemorySection } from './PersonalMemorySection.tsx'
import type { PersonalMemorySectionInjected } from './PersonalMemorySection.tsx'
import { en, zh, type PersonalMemoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.personalMemory': PersonalMemoryLocaleKey
  }
}

/** Required client services. */
export const inject = ['slots', 'locale']
const NS = 'settings.personalMemory'

/**
 * Register the desktop-only personal-memory section when the preload bridge exists.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const bridge = window.desktopPersonalMemory
  if (bridge === undefined) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-personal-memory: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-memory',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): PersonalMemorySectionInjected => ({ bridge, t }),
  }, PersonalMemorySection))
}

declare global {
  interface Window {
    desktopPersonalMemory?: PersonalMemoryBridge
  }
}

/** Supported categories for user-managed local memory. */
export type PersonalMemoryKind = 'PREFERENCE' | 'FACT' | 'CONTEXT' | 'JOURNAL'
/** One encrypted local-memory record exposed through the desktop bridge. */
export interface PersonalMemoryEntry {
  id: string
  kind: PersonalMemoryKind
  title: string
  summary: string
  scope: 'GLOBAL' | 'WORKSPACE'
  source: 'LOCAL_CONVERSATION'
  sourceSessionId?: string
  sourceEventSeq?: number
  createdAt: string
  updatedAt: string
}
/** Current opt-in state and records for the signed-in workcode. */
export interface PersonalMemoryState { enabled: boolean; entries: PersonalMemoryEntry[] }
/** Narrow IPC outcome that does not expose main-process errors to the renderer. */
export type BridgeResult<T> = { ok: true; value: T } | { ok: false; code: string }
/** Electron preload contract for managing personal local memory. */
export interface PersonalMemoryBridge {
  state(): Promise<BridgeResult<PersonalMemoryState>>
  setEnabled(enabled: boolean): Promise<BridgeResult<PersonalMemoryState>>
  remove(id: string): Promise<BridgeResult<PersonalMemoryState>>
  clear(): Promise<BridgeResult<PersonalMemoryState>>
}
