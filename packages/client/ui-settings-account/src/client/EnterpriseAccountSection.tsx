import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseAccountBridge, EnterpriseAccountProfile } from './index.ts'
import type { EnterpriseAccountLocaleKey } from './locales.ts'
import css from './EnterpriseAccountSection.module.css'

/** Values supplied by the Settings slot registration. */
export interface EnterpriseAccountSectionInjected {
  bridge: EnterpriseAccountBridge
  t: (key: EnterpriseAccountLocaleKey) => string
}

/** Slot-delivered injected values are partial until the registration is active. */
export type EnterpriseAccountSectionProps = Partial<EnterpriseAccountSectionInjected>

function avatarText(profile: EnterpriseAccountProfile): string {
  const source = profile.displayName?.trim() || profile.workcode
  return Array.from(source).slice(-2).join('').toUpperCase()
}

function authenticationLabel(providerId: string, t: EnterpriseAccountSectionInjected['t']): string {
  if (providerId === 'ldap' || providerId === 'directory-password') return t('authLdap')
  if (providerId === 'sso' || providerId === 'oidc') return t('authSso')
  if (providerId === 'wecom') return t('authWeCom')
  return t('authEnterprise')
}

function formattedExpiry(value: string, fallback: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString()
}

/** Render the signed-in enterprise profile and its explicit sign-out action. */
export function EnterpriseAccountSection({ bridge, t }: EnterpriseAccountSectionProps): ReactNode {
  if (bridge === undefined || t === undefined) return null
  return <Loaded bridge={bridge} t={t} />
}

function Loaded({ bridge, t }: EnterpriseAccountSectionInjected): ReactNode {
  const [profile, setProfile] = useState<EnterpriseAccountProfile | undefined>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutFailed, setLogoutFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setLoadFailed(false)
    void bridge.state().then((result) => {
      if (!active) return
      if (result.ok) setProfile(result.value)
      else setLoadFailed(true)
    }).catch(() => {
      if (active) setLoadFailed(true)
    })
    return () => { active = false }
  }, [bridge, reload])

  const logout = async (): Promise<void> => {
    setLoggingOut(true)
    setLogoutFailed(false)
    try {
      const result = await bridge.logout()
      if (!result.ok) {
        setLoggingOut(false)
        setLogoutFailed(true)
      }
    } catch {
      setLoggingOut(false)
      setLogoutFailed(true)
    }
  }

  if (profile === undefined) {
    return <section className={css.section}>{loadFailed
      ? <div className={css.failure}><p role="alert">{t('unavailable')}</p><button type="button" onClick={() => { setReload(value => value + 1) }} title={t('retry')} aria-label={t('retry')}><IconRefreshOutline16 aria-hidden="true" /></button></div>
      : <p className={css.status}>{t('loading')}</p>}</section>
  }

  const rows = [
    [t('workcode'), profile.workcode],
    [t('authMethod'), authenticationLabel(profile.providerId, t)],
    ...(profile.displayName === undefined ? [] : [[t('displayName'), profile.displayName]]),
    ...(profile.department === undefined ? [] : [[t('department'), profile.department]]),
    ...(profile.departmentCodes.length === 0 ? [] : [[t('departmentCodes'), profile.departmentCodes.join('、')]]),
    ...(profile.jobTitle === undefined ? [] : [[t('jobTitle'), profile.jobTitle]]),
    ...(profile.email === undefined ? [] : [[t('email'), profile.email]]),
    ...(profile.phone === undefined ? [] : [[t('phone'), profile.phone]]),
    [t('sessionExpiresAt'), formattedExpiry(profile.sessionExpiresAt, t('unknownDate'))],
  ]

  return <section className={css.section} aria-busy={loggingOut}>
    <header className={css.profileHeader}>
      <div className={css.avatar} aria-hidden="true">{avatarText(profile)}</div>
      <div className={css.identity}>
        <h2>{profile.displayName ?? t('accountFallback')}</h2>
        <p>{profile.workcode}</p>
        <span className={css.verified}><i aria-hidden="true" />{t('verified')}</span>
      </div>
    </header>

    <div className={css.heading}><h3>{t('title')}</h3><p>{t('description')}</p></div>
    <dl className={css.details}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>

    <div className={css.security}>
      <div><h3>{t('securityTitle')}</h3><p>{t('securityDescription')}</p></div>
      {!confirming
        ? <Button variant="outline" className={css.logout} onClick={() => { setConfirming(true); setLogoutFailed(false) }}>{t('logout')}</Button>
        : <div className={css.confirm}>
          <div><strong>{t('logoutConfirm')}</strong><p>{t('logoutConfirmDescription')}</p></div>
          <div className={css.confirmActions}>
            <Button variant="ghost" disabled={loggingOut} onClick={() => { setConfirming(false); setLogoutFailed(false) }}>{t('cancel')}</Button>
            <Button variant="outline" className={css.logout} disabled={loggingOut} onClick={() => { void logout() }}>{loggingOut ? t('loggingOut') : t('confirmLogout')}</Button>
          </div>
        </div>}
      {logoutFailed && <p className={css.error} role="alert">{t('logoutFailed')}</p>}
    </div>
  </section>
}
