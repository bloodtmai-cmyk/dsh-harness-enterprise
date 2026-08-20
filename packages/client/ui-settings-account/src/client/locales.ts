/** Simplified Chinese copy for the enterprise-account Settings section. */
export const zh = {
  nav: '个人', title: '企业账号', description: '这里展示当前登录会话从企业认证服务获得的身份信息。',
  accountFallback: '企业用户', verified: '已通过企业认证', loading: '正在读取账号信息...',
  unavailable: '暂时无法读取当前账号信息。', retry: '重新加载', workcode: '工号', authMethod: '认证方式',
  displayName: '姓名', department: '部门', departmentCodes: '部门代码', jobTitle: '岗位', email: '邮箱', phone: '手机',
  sessionExpiresAt: '登录有效期', authLdap: 'LDAP 企业目录', authSso: '企业单点登录', authWeCom: '企业微信', authEnterprise: '企业认证',
  securityTitle: '退出当前账号', securityDescription: '退出后会关闭当前会话并返回登录页，本机保存的个人记忆和企业授权不会转移给其他工号。',
  logout: '退出登录', logoutConfirm: '确认退出当前账号？', logoutConfirmDescription: '未保存的会话操作可能丢失。应用会重新启动并要求重新认证。',
  cancel: '取消', confirmLogout: '确认退出', loggingOut: '正在退出...', logoutFailed: '退出失败，请稍后重试。', unknownDate: '未知',
} as const

/** English copy for the enterprise-account Settings section. */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Profile', title: 'Enterprise account', description: 'Identity information supplied by the enterprise authentication service for this session.',
  accountFallback: 'Enterprise user', verified: 'Enterprise identity verified', loading: 'Loading account information...',
  unavailable: 'The current account information is temporarily unavailable.', retry: 'Reload', workcode: 'Workcode', authMethod: 'Authentication',
  displayName: 'Name', department: 'Department', departmentCodes: 'Department codes', jobTitle: 'Job title', email: 'Email', phone: 'Mobile',
  sessionExpiresAt: 'Session valid until', authLdap: 'LDAP directory', authSso: 'Enterprise SSO', authWeCom: 'WeCom', authEnterprise: 'Enterprise authentication',
  securityTitle: 'Sign out of this account', securityDescription: 'Signing out closes this session and returns to login. Local memory and enterprise authorization remain isolated by workcode.',
  logout: 'Sign out', logoutConfirm: 'Sign out of the current account?', logoutConfirmDescription: 'Unsaved session actions may be lost. The app will restart and require authentication again.',
  cancel: 'Cancel', confirmLogout: 'Sign out', loggingOut: 'Signing out...', logoutFailed: 'Unable to sign out. Try again.', unknownDate: 'Unknown',
}

/** Stable translation keys owned by this package. */
export type EnterpriseAccountLocaleKey = keyof typeof zh
