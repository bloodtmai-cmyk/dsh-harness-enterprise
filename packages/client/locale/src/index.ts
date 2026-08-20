/** Host registration for the browser locale preference. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from './locale-settings.ts'
import type { LocaleId } from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/** Managed desktop flag that links the UI locale to model-facing output guidance. */
export const OUTPUT_LANGUAGE_FROM_LOCALE_ENV = 'DSH_OUTPUT_LANGUAGE_FROM_LOCALE'

/**
 * Build stable model guidance for the selected working language.
 * @param locale - Current Harness locale preference.
 * @returns System-prompt guidance that preserves code and identifier spelling.
 */
export function outputLanguageInstruction(locale: LocaleId): string {
  const language = locale === 'en' ? 'English' : 'Simplified Chinese'
  return `Use ${language} for all natural-language output, including visible analysis or reasoning, plans, tool explanations, and final responses. `
    + 'Keep code, commands, identifiers, file paths, and quoted source text in their original language unless the user asks for translation.'
}

/**
 * Register the durable locale section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      settingsNamespace(LOCALE_SETTINGS_NAMESPACE),
      LocaleSettingsSchema,
    )
    if (environment()[OUTPUT_LANGUAGE_FROM_LOCALE_ENV] !== '1') return
    settingsCtx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'user:output-language',
        order: 10,
        text: () => outputLanguageInstruction(scope.get().preference ?? desktopLanguageFallback()),
      })
    })
  })
}

function desktopLanguageFallback(): LocaleId {
  return environment().DSH_DESKTOP_LANGUAGE === 'en' ? 'en' : 'zh'
}

function environment(): Readonly<Record<string, string | undefined>> {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
  return runtime.process?.env ?? {}
}
