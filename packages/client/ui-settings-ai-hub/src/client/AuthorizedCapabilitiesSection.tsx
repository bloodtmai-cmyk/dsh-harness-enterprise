import { useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { AiHubCapabilityView, AiHubMarketItem, AiHubMarketSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconApiOutline14,
  IconCheckOutline14,
  IconCordisPluginOutline14,
  IconDataOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSkillOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AiHubSettingsLocaleKey } from './locales.ts'
import css from './AuthorizedCapabilitiesSection.module.css'

type Filter = 'all' | 'mcp' | 'skill' | 'bundle' | 'plugin'

export interface AuthorizedCapabilitiesInjected {
  market: () => Promise<AiHubMarketSnapshot>
  request: (capabilityId: string, reason: string) => Promise<void>
  skillSetup?: ManagedSkillSetupBridge
  t: (key: AiHubSettingsLocaleKey) => string
}

export type AuthorizedCapabilitiesSectionProps = AuthorizedCapabilitiesInjected

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: AiHubMarketSnapshot }

export interface ManagedSkillSetupState {
  capabilityExternalRef: string
  status: 'unavailable' | 'unauthorized' | 'authorizing' | 'authorized' | 'failed'
  version?: string
  qrDataUrl?: string
  expiresAt?: string
  writeExpiresAt?: string
  writeReauthenticationRequired?: boolean
  reason?: 'cli-unauthorized' | 'reauthentication-required' | 'expired' | 'workcode-changed'
}

type ManagedSkillSetupResult =
  | { ok: true; value: ManagedSkillSetupState }
  | { ok: false; code: string }

export interface ManagedSkillSetupBridge {
  state(externalRef: string): Promise<ManagedSkillSetupResult>
  start(externalRef: string): Promise<ManagedSkillSetupResult>
  cancel(externalRef: string): Promise<ManagedSkillSetupResult>
  subscribe(listener: (state: ManagedSkillSetupState) => void): () => void
}

function filterOf(type: AiHubCapabilityView['type']): Exclude<Filter, 'all'> {
  if (type === 'MCP' || type === 'TOOL') return 'mcp'
  if (type === 'SKILL') return 'skill'
  if (type === 'BUNDLE') return 'bundle'
  return 'plugin'
}

function typeLabel(type: AiHubCapabilityView['type'], t: AuthorizedCapabilitiesInjected['t']): string {
  if (type === 'SKILL') return t('skill')
  if (type === 'BUNDLE') return t('bundle')
  if (type === 'CLIENT_PLUGIN') return t('plugin')
  if (type === 'INSTRUCTION') return t('instruction')
  if (type === 'TOOL') return t('tool')
  return t('mcp')
}

function supportsWeComSetup(item: AiHubMarketItem): boolean {
  return item.capability.type === 'CLIENT_PLUGIN' && item.capability.externalRef === 'wecom-office'
}

function CapabilityIcon({ type }: { type: AiHubCapabilityView['type'] }): ReactNode {
  if (type === 'MCP' || type === 'TOOL') return <IconApiOutline14 size={18} aria-hidden="true" />
  if (type === 'SKILL') return <IconSkillOutline16 size={18} aria-hidden="true" />
  if (type === 'BUNDLE') return <IconDataOutline16 size={18} aria-hidden="true" />
  return <IconCordisPluginOutline14 size={18} aria-hidden="true" />
}

function formatResultCount(template: string, visible: number, total: number): string {
  return template.replace('{visible}', String(visible)).replace('{total}', String(total))
}

function MarketCard({ item, request, skillSetup, t, onChanged }: {
  item: AiHubMarketItem
  request: AuthorizedCapabilitiesInjected['request']
  skillSetup?: ManagedSkillSetupBridge
  t: AuthorizedCapabilitiesInjected['t']
  onChanged: () => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const capability = item.capability

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const reasonValue = new FormData(event.currentTarget).get('reason')
    const reason = typeof reasonValue === 'string' ? reasonValue.trim() : ''
    if (reason.length === 0) return
    setSaving(true); setError('')
    try { await request(capability.id, reason); setEditing(false); onChanged() }
    catch { setError(t('requestError')) }
    finally { setSaving(false) }
  }

  return <li className={css.card} data-capability-type={capability.type}>
    <div className={css.cardHeader}>
      <span className={css.capabilityIcon}><CapabilityIcon type={capability.type} /></span>
      <div className={css.identity}>
        <strong title={capability.name}>{capability.name}</strong>
        <div className={css.meta}>
          <span className={css.type}>{typeLabel(capability.type, t)}</span>
          <span className={css.version}>v{capability.releaseVersion}</span>
        </div>
      </div>
      <span className={`${css.state} ${css[`state${item.state}`]}`}>
        {item.state === 'AUTHORIZED' ? <IconCheckOutline14 size={12} aria-hidden="true" /> : null}
        {t(`state${item.state}`)}
      </span>
    </div>
    {capability.description ? <p className={css.description}>{capability.description}</p> : null}
    {item.state === 'REJECTED' && item.latestApplication?.decisionComment ? <p className={css.decision}>{item.latestApplication.decisionComment}</p> : null}
    <div className={css.cardFooter}>
      <code title={capability.externalRef}>{capability.externalRef}</code>
      {item.state === 'AVAILABLE' || item.state === 'REJECTED' ? <button className={css.requestButton} type="button" onClick={() => { setEditing(value => !value) }}>{t(item.state === 'REJECTED' ? 'requestAgain' : 'request')}</button> : null}
    </div>
    {item.state === 'AUTHORIZED' && supportsWeComSetup(item) && skillSetup !== undefined
      ? <ManagedSkillSetupControl externalRef={capability.externalRef} setup={skillSetup} t={t} />
      : null}
    {editing ? <form className={css.requestForm} onSubmit={(event) => { void submit(event) }}>
      <label><span className={css.fieldLabel}>{t('reason')}</span><textarea name="reason" required maxLength={500} rows={3} placeholder={t('reasonPlaceholder')} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div><button type="button" onClick={() => { setEditing(false) }}>{t('cancel')}</button><button type="submit" disabled={saving}>{saving ? t('submitting') : t('submit')}</button></div>
    </form> : null}
  </li>
}

function ManagedSkillSetupControl({ externalRef, setup, t }: {
  externalRef: string
  setup: ManagedSkillSetupBridge
  t: AuthorizedCapabilitiesInjected['t']
}): ReactNode {
  const [state, setState] = useState<ManagedSkillSetupState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void setup.state(externalRef).then((result) => {
      if (active && result.ok) setState(result.value)
    })
    const unsubscribe = setup.subscribe((next) => {
      if (active && next.capabilityExternalRef === externalRef) setState(next)
    })
    return () => { active = false; unsubscribe() }
  }, [externalRef, setup])

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await setup.start(externalRef)
      if (result.ok) setState(result.value)
    } finally {
      setBusy(false)
    }
  }
  const cancel = async (): Promise<void> => {
    const result = await setup.cancel(externalRef)
    if (result.ok) setState(result.value)
  }

  if (state === null) return null
  if (state.status === 'authorized') return <div className={css.setupStatus}>
    <span>{t('weComAuthorized')}</span>
    <small>{t('weComOutboundOnly')}</small>
    {state.expiresAt ? <small>{t('weComValidUntil')} {new Date(state.expiresAt).toLocaleString()}</small> : null}
    {state.writeReauthenticationRequired ? <small className={css.setupError}>{t('weComWriteReauth')}</small> : null}
    <button type="button" disabled={busy} onClick={() => { void start() }}>{busy ? t('weComStarting') : t('weComRebind')}</button>
  </div>
  if (state.status === 'unavailable') return <div className={css.setupStatus}><span className={css.setupError}>{t('weComUnavailable')}</span></div>
  if (state.status === 'unauthorized') return <div className={css.setupStatus}>
    <span>{state.reason === 'expired' || state.reason === 'workcode-changed' || state.reason === 'reauthentication-required'
      ? t('weComNeedsReauthentication')
      : t('weComNeedsBinding')}</span>
    <button type="button" disabled={busy} onClick={() => { void start() }}>{busy ? t('weComStarting') : t('weComBind')}</button>
  </div>
  if (state.status === 'failed') return <div className={css.setupStatus}><span className={css.setupError}>{t('weComBindingFailed')}</span><button type="button" disabled={busy} onClick={() => { void start() }}>{t('retry')}</button></div>
  return <div className={css.setupPanel}>
    <div><strong>{t('weComScanTitle')}</strong><button type="button" onClick={() => { void cancel() }}>{t('cancel')}</button></div>
    {state.qrDataUrl === undefined
      ? <p>{t('weComGeneratingQr')}</p>
      : <img src={state.qrDataUrl} alt={t('weComQrAlt')} />}
    <p>{t('weComScanHelp')}</p>
  </div>
}

export function AuthorizedCapabilitiesSection({ market, request, skillSetup, t }: AuthorizedCapabilitiesSectionProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())

  useEffect(() => {
    let current = true
    void market().then((snapshot) => { if (current) setState({ status: 'ready', snapshot }) }, () => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [market, revision])

  const items = useMemo(() => state.status === 'ready' ? state.snapshot.items : [], [state])
  const visible = useMemo(() => items.filter((item) => {
    if (filter !== 'all' && filterOf(item.capability.type) !== filter) return false
    if (deferredQuery.length === 0) return true
    const capability = item.capability
    return [capability.name, capability.externalRef, capability.description ?? '']
      .some(value => value.toLocaleLowerCase().includes(deferredQuery))
  }), [deferredQuery, filter, items])
  const refresh = (): void => { setState({ status: 'loading' }); setRevision(value => value + 1) }
  const filters: readonly Filter[] = ['all', 'mcp', 'skill', 'bundle', 'plugin']

  return <section className={css.section} aria-busy={state.status === 'loading'}>
    {state.status === 'loading' ? <div className={css.loading}>
      <span className={css.srOnly}>{t('loading')}</span>
      <div className={css.skeletonGrid} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
    </div> : null}
    {state.status === 'error' ? <div className={css.failure}><p role="alert">{t('error')}</p><button type="button" onClick={refresh} title={t('retry')}><IconRefreshOutline16 aria-hidden="true" /></button></div> : null}
    {state.status === 'ready' && !state.snapshot.available ? <p className={css.status}>{t('unavailable')}</p> : null}
    {state.status === 'ready' && state.snapshot.available ? <>
      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 size={16} aria-hidden="true" />
          <span className={css.srOnly}>{t('search')}</span>
          <input
            type="search"
            value={query}
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <div className={css.filters} role="group" aria-label={t('filterLabel')}>{filters.map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value) }}>{t(value)}<span>{value === 'all' ? items.length : items.filter(item => filterOf(item.capability.type) === value).length}</span></button>)}</div>
        <button className={css.refresh} type="button" onClick={refresh} aria-label={t('retry')} title={t('retry')}><IconRefreshOutline16 aria-hidden="true" /></button>
      </div>
      <div className={css.catalogMeta}>
        <span role="status" aria-live="polite" aria-atomic="true">
          {formatResultCount(t('resultCount'), visible.length, items.length)}
        </span>
        {state.snapshot.evaluatedAt ? <time dateTime={state.snapshot.evaluatedAt}>{t('refreshed')} {new Date(state.snapshot.evaluatedAt).toLocaleString()}</time> : null}
      </div>
      {items.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      {items.length > 0 && visible.length === 0 ? <p className={css.status}>{deferredQuery.length > 0 ? t('emptySearch') : t('emptyFilter')}</p> : null}
      {visible.length > 0 ? <ul className={css.grid}>{visible.map(item => <MarketCard
        key={item.capability.id}
        item={item}
        request={request}
        {...skillSetup === undefined ? {} : { skillSetup }}
        t={t}
        onChanged={refresh}
      />)}</ul> : null}
    </> : null}
  </section>
}
