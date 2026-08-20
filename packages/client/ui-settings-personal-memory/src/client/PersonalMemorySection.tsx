import { useEffect, useState, type ReactNode } from 'react'
import { IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PersonalMemoryBridge, PersonalMemoryEntry, PersonalMemoryState } from './index.ts'
import type { PersonalMemoryLocaleKey } from './locales.ts'
import css from './PersonalMemorySection.module.css'

/** Values supplied by the Settings slot registration. */
export interface PersonalMemorySectionInjected {
  /** Narrow Electron IPC bridge. */
  bridge: PersonalMemoryBridge
  /** Bound package-local translator. */
  t: (key: PersonalMemoryLocaleKey) => string
}

/** Slot-delivered injected values are partial until the registration is active. */
export type PersonalMemorySectionProps = Partial<PersonalMemorySectionInjected>

interface InjectionPreview {
  always: PersonalMemoryEntry[]
  conditional: PersonalMemoryEntry[]
}

/** Mirror the runtime's hard prompt budgets so Settings shows the maximum next-request payload. */
export function buildInjectionPreview(entries: readonly PersonalMemoryEntry[]): InjectionPreview {
  const always: PersonalMemoryEntry[] = []
  let alwaysCharacters = 0
  for (const entry of entries) {
    if (entry.scope !== 'GLOBAL' || (entry.kind !== 'PREFERENCE' && entry.kind !== 'FACT')) continue
    const characters = entry.title.length + entry.summary.length
    if (always.length === 8 || alwaysCharacters + characters > 2_000) break
    always.push(entry); alwaysCharacters += characters
  }
  const conditional: PersonalMemoryEntry[] = []
  let conditionalCharacters = 0
  let journalCharacters = 0
  let journals = 0
  for (const entry of entries) {
    if (entry.scope === 'GLOBAL' && (entry.kind === 'PREFERENCE' || entry.kind === 'FACT')) continue
    const characters = entry.title.length + entry.summary.length
    if (entry.kind === 'JOURNAL') {
      if (journals === 2 || journalCharacters + entry.summary.length > 600) continue
      journals += 1; journalCharacters += entry.summary.length
    }
    if (conditional.length === 5 || conditionalCharacters + characters > 2_000) break
    conditional.push(entry); conditionalCharacters += characters
  }
  return { always, conditional }
}

/**
 * Render the encrypted personal-memory Settings section.
 * @param props - slot-delivered bridge and copy.
 * @returns the section, or null before injection is ready.
 */
export function PersonalMemorySection({ bridge, t }: PersonalMemorySectionProps): ReactNode {
  if (bridge === undefined || t === undefined) return null
  return <Loaded bridge={bridge} t={t} />
}

function Loaded({ bridge, t }: PersonalMemorySectionInjected): ReactNode {
  const [state, setState] = useState<PersonalMemoryState | undefined>()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async (): Promise<void> => {
    setError(false)
    const result = await bridge.state()
    if (result.ok) setState(result.value)
    else setError(true)
  }
  useEffect(() => { void load() }, [bridge])

  const run = async (action: () => Promise<{ ok: true; value: PersonalMemoryState } | { ok: false; code: string }>): Promise<boolean> => {
    setBusy(true); setNotice('')
    try {
      const result = await action()
      if (!result.ok) { setNotice(t('failed')); return false }
      setState(result.value); setNotice(t('saved')); return true
    } finally { setBusy(false) }
  }

  if (state === undefined) return <section className={css.section}>{error
    ? <div className={css.failure}><p role="alert">{t('unavailable')}</p><button type="button" onClick={() => { void load() }} title={t('loading')}><IconRefreshOutline16 aria-hidden="true" /></button></div>
    : <p className={css.status}>{t('loading')}</p>}</section>

  const preview = buildInjectionPreview(state.entries)

  return <section className={css.section} aria-busy={busy}>
    <header className={css.header}>
      <div><h2>{t('title')}</h2><p>{t('description')}</p></div>
      <label className={css.switch}><input type="checkbox" checked={state.enabled} disabled={busy} onChange={(event) => {
        const enabled = event.currentTarget.checked
        void run(() => bridge.setEnabled(enabled))
      }} /><span aria-hidden="true" /><b>{state.enabled ? t('enabled') : t('disabled')}</b></label>
    </header>

    <p className={css.privacy}>{t('privacy')}</p>

    <div className={css.preview}>
      <div><h3>{t('previewTitle')}</h3><p>{t('previewDescription')}</p></div>
      {preview.always.length === 0 && preview.conditional.length === 0
        ? <p className={css.status}>{t('previewEmpty')}</p>
        : <div className={css.previewGroups}>
          {preview.always.length > 0 && <div><strong>{t('previewAlways')}</strong><ul>{preview.always.map(entry => <li key={entry.id}><b>{entry.title}</b><span>{entry.summary}</span></li>)}</ul></div>}
          {preview.conditional.length > 0 && <div><strong>{t('previewConditional')}</strong><ul>{preview.conditional.map(entry => <li key={entry.id}><b>{entry.title}</b><span>{entry.summary}</span></li>)}</ul></div>}
        </div>}
    </div>

    <div className={css.toolbar}><strong>{t('captured')} <span>{state.entries.length}</span></strong><div>
      <button className={css.danger} type="button" disabled={busy || state.entries.length === 0} onClick={() => {
        if (window.confirm(t('clearConfirm'))) void run(() => bridge.clear())
      }}>{t('clear')}</button>
    </div></div>

    {state.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : <ul className={css.list}>{state.entries.map(entry => <li key={entry.id}>
      <div><span className={css.kind}>{t(entry.kind === 'PREFERENCE' ? 'preference' : entry.kind === 'FACT' ? 'fact' : entry.kind === 'CONTEXT' ? 'context' : 'journal')}</span><h3>{entry.title}</h3><p>{entry.summary}</p><time dateTime={entry.updatedAt}>{t('localConversation')} · {new Date(entry.updatedAt).toLocaleString()}</time></div>
      <div className={css.rowActions}><button type="button" title={t('remove')} aria-label={t('remove')} onClick={() => {
        if (window.confirm(t('removeConfirm'))) void run(() => bridge.remove(entry.id))
      }}><IconTrashOutline16 aria-hidden="true" /></button></div>
    </li>)}</ul>}
    <div className={css.notice} aria-live="polite">{notice}</div>
  </section>
}
