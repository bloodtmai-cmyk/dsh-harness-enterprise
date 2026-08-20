/** AI Hub enterprise market registered as a permission-controlled sidebar destination. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { AuthorizedCapabilitiesInjected } from './AuthorizedCapabilitiesSection.tsx'
import {
  EnterpriseMarketRoot,
  ManagedUpdateAction,
  type ManagedUpdateBridge,
  type ManagedUpdateActionInjected,
  type EnterpriseMarketInjected,
} from './EnterpriseMarketRoot.tsx'
import { en, zh, type AiHubSettingsLocaleKey } from './locales.ts'

export type {
  AuthorizedCapabilitiesInjected,
  AuthorizedCapabilitiesSectionProps,
  ManagedSkillSetupBridge,
  ManagedSkillSetupState,
} from './AuthorizedCapabilitiesSection.tsx'
export type {
  ManagedUpdateBridge,
  ManagedUpdateActionInjected,
  ManagedUpdateActionProps,
  ManagedUpdateItem,
  ManagedUpdateState,
  EnterpriseMarketInjected,
  EnterpriseMarketRootProps,
} from './EnterpriseMarketRoot.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AI Hub enterprise-market copy. */
    'aiHub.market': AiHubSettingsLocaleKey
  }
}

/** Locale namespace owned by the enterprise-market contribution. */
export const NS = 'aiHub.market'

/** Services required by the sidebar registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.aiHubCatalog']

/** Contribute the permission-controlled market trigger and dialog. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-ai-hub: dictionaries')
  const t = ctx.locale.bind(NS)
  const entitlements: EnterpriseMarketInjected['entitlements'] = async () => {
    const result = await ctx.remote.aiHubCatalog.entitlements()
    if (!result.ok) throw new Error(`aiHubCatalog.entitlements failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const market: AuthorizedCapabilitiesInjected['market'] = async () => {
    const result = await ctx.remote.aiHubCatalog.market()
    if (!result.ok) throw new Error(`aiHubCatalog.market failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const request: AuthorizedCapabilitiesInjected['request'] = async (capabilityId, reason) => {
    const result = await ctx.remote.aiHubCatalog.request(capabilityId, reason)
    if (!result.ok) throw new Error(`aiHubCatalog.request failed: ${result.error.code}: ${result.error.message}`)
  }
  const skillSetup = window.desktopManagedSkillSetup
  const marketInjected = (): EnterpriseMarketInjected => ({
    entitlements,
    market,
    request,
    ...(skillSetup === undefined ? {} : { skillSetup }),
    t,
  })
  const updateInjected = (): ManagedUpdateActionInjected => ({
    ...(window.desktopManagedUpdates === undefined ? {} : { updates: window.desktopManagedUpdates }),
    t,
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'ai-hub-market',
    order: 10,
    inject: marketInjected,
  }, EnterpriseMarketRoot))
  ctx.slots.inject('sidebar.settings.action', () => ctx.slots.register({
    name: 'sidebar.settings.action',
    id: 'managed-updates',
    order: 10,
    inject: updateInjected,
  }, ManagedUpdateAction))
}

declare global {
  interface Window {
    desktopManagedUpdates?: ManagedUpdateBridge
    desktopManagedSkillSetup?: import('./AuthorizedCapabilitiesSection.tsx').ManagedSkillSetupBridge
  }
}
