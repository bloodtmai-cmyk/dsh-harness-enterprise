/** `settings.locale` namespace dictionaries (the Language row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'language.title': '语言',
  'language.description': '界面与 AI 输出语言',
} satisfies Record<string, string>

/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'language.title': 'Language',
  'language.description': 'Interface and AI output language',
} satisfies Record<SettingsLocaleKey, string>
