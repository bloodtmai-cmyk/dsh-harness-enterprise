/** Simplified Chinese copy for the personal-memory Settings section. */
export const zh = {
  nav: '个人记忆', captured: '自动采集的记忆', title: '个人本地长期记忆', description: '自动沉淀稳定偏好、长期事实、项目上下文和近期工作摘要，只保存在当前设备并按登录工号加密隔离。',
  enabled: '已启用', disabled: '未启用',
  loading: '正在读取本地记忆...', unavailable: '当前桌面环境无法使用系统加密存储。', empty: '还没有自动采集到长期记忆。',
  preference: '偏好', fact: '事实', context: '上下文', journal: '近期工作', remove: '删除',
  clear: '清空全部', clearConfirm: '确定清空当前工号在本机保存的全部个人记忆？此操作不可撤销。',
  removeConfirm: '确定删除这条个人记忆？', saved: '已保存', failed: '操作失败，请稍后重试。',
  privacy: '不会采集密码、API Key、Token、工具过程或原始对话全文；近期工作每日最多 4 条并保留 30 天，企业指令、身份、权限和安全策略始终优先。',
  previewTitle: '下一轮注入预览', previewDescription: '展示模型下一轮最多可能收到的本地记忆；短确认、问候和继续执行不会触发召回。',
  previewAlways: '固定注入', previewConditional: '仅相关请求召回', previewEmpty: '当前没有会注入的记忆。', localConversation: '来自本地会话',
} as const

/** English copy for the personal-memory Settings section. */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Personal memory', captured: 'Automatically captured', title: 'Personal local memory', description: 'Stable preferences, durable facts, project context, and recent-work summaries are captured, encrypted for the signed-in workcode, and kept only on this device.',
  enabled: 'Enabled', disabled: 'Disabled',
  loading: 'Loading local memory...', unavailable: 'System credential encryption is unavailable in this desktop environment.', empty: 'No long-term memories have been captured yet.',
  preference: 'Preference', fact: 'Fact', context: 'Context', journal: 'Recent work', remove: 'Delete',
  clear: 'Clear all', clearConfirm: 'Clear every personal memory stored on this device for the current workcode? This cannot be undone.',
  removeConfirm: 'Delete this personal memory?', saved: 'Saved', failed: 'The operation failed. Try again.',
  privacy: 'Passwords, API keys, tokens, tool traces, and raw transcripts are not captured. Recent work is limited to four entries per day and retained for 30 days; enterprise instructions, identity, permissions, and safety policy always take priority.',
  previewTitle: 'Next-turn injection preview', previewDescription: 'The maximum local memory the model could receive next. Greetings, acknowledgements, and continue-only messages do not trigger recall.',
  previewAlways: 'Always injected', previewConditional: 'Relevant requests only', previewEmpty: 'No memory is currently eligible for injection.', localConversation: 'Local conversation',
}

/** Stable translation keys owned by this package. */
export type PersonalMemoryLocaleKey = keyof typeof zh
