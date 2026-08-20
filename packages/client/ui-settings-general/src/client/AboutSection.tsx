import { BrandWordmark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsKey } from './locales.ts'
import css from './AboutSection.module.css'

/** Desktop application identity exposed by the Electron preload bridge. */
export interface DesktopAppInfo {
  /** User-facing product name. */
  productName: string
  /** Packaged Electron application version. */
  version: string
}

/** Values supplied by the About Settings registration. */
export interface AboutSectionInjected {
  /** Trusted desktop identity. */
  info: DesktopAppInfo
  /** Bound settings translator. */
  t: (key: SettingsKey) => string
}

/** Slot-delivered values are partial until the registration is active. */
export type AboutSectionProps = Partial<AboutSectionInjected>

/**
 * Render desktop product identity and the installed application version.
 * @param props - slot-delivered identity and copy.
 * @returns the About section, or null before injection is ready.
 */
export function AboutSection({ info, t }: AboutSectionProps) {
  if (info === undefined || t === undefined) return null
  return (
    <section className={css.section} aria-labelledby="settings-about-title">
      <div className={css.identity}>
        <BrandWordmark className={css.wordmark} size={32} />
        <h2 id="settings-about-title">{info.productName}</h2>
      </div>
      <dl className={css.details}>
        <div className={css.row}>
          <dt>{t('about.version')}</dt>
          <dd>{info.version}</dd>
        </div>
      </dl>
    </section>
  )
}
