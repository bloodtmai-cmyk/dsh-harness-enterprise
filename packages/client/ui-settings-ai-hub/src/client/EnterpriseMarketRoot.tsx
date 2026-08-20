import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AiHubMenuEntitlements } from '@deepseek-ai/dsh-api-remotes/client'
import { IconCloseOutline16, IconCordisPluginOutline14, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  AuthorizedCapabilitiesSection,
  type AuthorizedCapabilitiesInjected,
} from './AuthorizedCapabilitiesSection.tsx'
import type { AiHubSettingsLocaleKey } from './locales.ts'
import css from './EnterpriseMarketRoot.module.css'

const ENTITLEMENT_REFRESH_MS = 60_000

/** Host-backed operations available to the permission-controlled market entry. */
export interface EnterpriseMarketInjected extends AuthorizedCapabilitiesInjected {
  entitlements: () => Promise<AiHubMenuEntitlements>
  t: (key: AiHubSettingsLocaleKey) => string
}

/** Sidebar owner state plus the market's private Host face. */
export type EnterpriseMarketRootProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<EnterpriseMarketInjected>

/** Desktop update bridge injected into the compact Settings-adjacent action. */
export interface ManagedUpdateActionInjected {
  updates?: ManagedUpdateBridge
  t: (key: AiHubSettingsLocaleKey) => string
}

/** Owner state plus the desktop-owned update bridge. */
export type ManagedUpdateActionProps = PropsRuntime<'sidebar.settings.action'>
  & InjectFace<ManagedUpdateActionInjected>

type EntitlementState = 'loading' | 'authorized' | 'denied'

/** One desktop-owned update row; managed deployments currently publish Harness binaries here. */
export interface ManagedUpdateItem {
  type: 'HARNESS' | 'MCP' | 'TOOL' | 'SKILL' | 'BUNDLE' | 'CLIENT_PLUGIN'
  externalRef: string
  name: string
  fromVersion: string
  toVersion: string
  notes?: string
  action?: 'GRANTED' | 'REVOKED' | 'UPDATED'
}
/** Desktop-owned binary update state exposed through a narrow preload bridge. */
export interface ManagedUpdateState {
  status: 'none' | 'available' | 'scheduled' | 'downloading' | 'failed'
  updates: ManagedUpdateItem[]
}
/** Narrow Electron preload bridge used only for the update affordance. */
export interface ManagedUpdateBridge {
  state(): Promise<{ ok: true; value: ManagedUpdateState } | { ok: false; code: string }>
  open(): Promise<{ ok: true; value: ManagedUpdateState } | { ok: false; code: string }>
  subscribe(listener: (state: ManagedUpdateState) => void): () => void
}

/** Render the market trigger only while AI Hub grants the current user its menu key. */
export function EnterpriseMarketRoot(
  { wide, entitlements, market, request, skillSetup, t }: EnterpriseMarketRootProps,
): ReactNode {
  const [entitlement, setEntitlement] = useState<EntitlementState>('loading')
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void entitlements().then(
        (result) => {
          if (!active) return
          setEntitlement(result.available && result.menus.includes('PLUGIN_MARKET') ? 'authorized' : 'denied')
        },
        () => { if (active) setEntitlement('denied') },
      )
    }
    refresh()
    const timer = window.setInterval(refresh, ENTITLEMENT_REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [entitlements])

  useEffect(() => {
    if (entitlement !== 'authorized') setOpen(false)
  }, [entitlement])

  const close = useCallback(() => { setOpen(false) }, [])
  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [close, open])

  if (entitlement !== 'authorized') return null

  return <>
    <div className={css.actions}>
      <button
        type="button"
        className={`${css.trigger} ${wide ? '' : css.rail}`}
        aria-label={t('nav')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        <IconCordisPluginOutline14 size={wide ? 16 : 18} aria-hidden="true" />
        {wide ? <span>{t('nav')}</span> : null}
      </button>
    </div>
    {open ? <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={close} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={css.header}>
          <div>
            <p className={css.eyebrow}>{t('eyebrow')}</p>
            <h1 id={titleId}>{t('title')}</h1>
          </div>
          <button ref={closeButton} type="button" className={css.close} aria-label={t('close')} onClick={close}>
            <IconCloseOutline16 size={16} aria-hidden="true" />
          </button>
        </header>
        <div className={css.content}>
          <AuthorizedCapabilitiesSection
            market={market}
            request={request}
            {...skillSetup === undefined ? {} : { skillSetup }}
            t={t}
          />
        </div>
      </div>
    </div> : null}
  </>
}

/** Render the single Codex-style update icon immediately beside Settings. */
export function ManagedUpdateAction({ updates, t }: ManagedUpdateActionProps): ReactNode {
  const [state, setState] = useState<ManagedUpdateState>({ status: 'none', updates: [] })

  useEffect(() => {
    if (updates === undefined) return
    let active = true
    void updates.state().then((result) => {
      if (active && result.ok) setState(result.value)
    })
    const unsubscribe = updates.subscribe((next) => { if (active) setState(next) })
    return () => { active = false; unsubscribe() }
  }, [updates])

  if (state.status === 'none') return null
  const label = t(state.status === 'scheduled'
    ? 'updateScheduled'
    : state.status === 'downloading'
      ? 'updateDownloading'
      : state.status === 'failed'
        ? 'updateFailed'
        : 'updateAvailable')

  return <button
    type="button"
    className={css.updateTrigger}
    aria-label={label}
    title={label}
    disabled={state.status === 'downloading'}
    onClick={() => { void updates?.open() }}
  >
    <IconDownloadOutline16 size={17} aria-hidden="true" />
    <span className={css.updateDot} aria-hidden="true" />
  </button>
}
