/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'remoteAccess.notice': '设置、凭据和预设管理仅限服务器本机访问。请在服务器打开 http://127.0.0.1:<端口>，或使用 SSH 本地端口转发后访问 127.0.0.1。',
  'general.nav': '通用设置',
  'about.nav': '关于',
  'about.version': '版本',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'remoteAccess.notice': 'Settings, credentials, and preset management require server-local access. Open http://127.0.0.1:<port> on the server, or use SSH local port forwarding and access 127.0.0.1.',
  'general.nav': 'General',
  'about.nav': 'About',
  'about.version': 'Version',
} satisfies Record<SettingsKey, string>
