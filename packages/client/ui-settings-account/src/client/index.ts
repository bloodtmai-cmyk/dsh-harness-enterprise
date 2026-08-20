import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { EnterpriseAccountSection } from './EnterpriseAccountSection.tsx'
import type { EnterpriseAccountSectionInjected } from './EnterpriseAccountSection.tsx'
import { en, zh, type EnterpriseAccountLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.enterpriseAccount': EnterpriseAccountLocaleKey
  }
}

/** Required client services. */
export const inject = ['slots', 'locale']
const NS = 'settings.enterpriseAccount'

/** Register the desktop-only profile section when the narrow preload bridge exists. */
export function apply(ctx: ClientContext): void {
  const bridge = window.desktopEnterpriseAccount
  if (bridge === undefined) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-account: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal',
    order: 5,
    label: () => t('nav'),
    locale: NS,
    inject: (): EnterpriseAccountSectionInjected => ({ bridge, t }),
  }, EnterpriseAccountSection))
}

declare global {
  interface Window {
    desktopEnterpriseAccount?: EnterpriseAccountBridge
  }
}

/** Sanitized enterprise identity exposed by Electron; it never includes credentials or tokens. */
export interface EnterpriseAccountProfile {
  workcode: string
  providerId: string
  displayName?: string
  department?: string
  departmentCodes: string[]
  jobTitle?: string
  email?: string
  phone?: string
  sessionExpiresAt: string
}
/** Narrow IPC outcome that does not expose main-process errors to the renderer. */
export type BridgeResult<T> = { ok: true; value: T } | { ok: false; code: string }
/** Electron preload contract for reading and ending the current enterprise session. */
export interface EnterpriseAccountBridge {
  state(): Promise<BridgeResult<EnterpriseAccountProfile>>
  logout(): Promise<{ ok: true } | { ok: false; code: string }>
}
