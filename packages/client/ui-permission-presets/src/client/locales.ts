/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'preset.readOnly': '只读',
  'preset.workspaceWrite': '工作区写入',
  'preset.fullAccess': '完全访问',
  'preset.custom': '自定义',
  'preset.description.readOnly': '只允许读取；写入文件或执行外部命令前会请求审批。',
  'preset.description.workspaceWrite': '可在工作区和允许的临时目录中写入；超出范围的操作需要审批。',
  'preset.description.fullAccess': '可在不弹出审批提示的情况下访问全部文件。',
  'confirm.title': '确认启用完全访问？',
  'confirm.description': '启用完全访问后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全访问',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'preset.readOnly': 'Read only',
  'preset.workspaceWrite': 'Workspace write',
  'preset.fullAccess': 'Full access',
  'preset.custom': 'Custom',
  'preset.description.readOnly': 'Read only; approval is required before writing files or running external commands.',
  'preset.description.workspaceWrite': 'Write inside the workspace and permitted temporary directories; operations outside that scope require approval.',
  'preset.description.fullAccess': 'Access all files without approval prompts.',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'preset.readOnly': '只读',
  'preset.workspaceWrite': '工作区写入',
  'preset.fullAccess': '完全访问',
  'preset.custom': '自定义',
  'preset.description.readOnly': '只允许读取；写入文件或执行外部命令前会请求审批。',
  'preset.description.workspaceWrite': '可在工作区和允许的临时目录中写入；超出范围的操作需要审批。',
  'preset.description.fullAccess': '可在不弹出审批提示的情况下访问全部文件。',
  'confirm.title': '确认启用完全访问？',
  'confirm.description': '启用完全访问后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全访问',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'preset.readOnly': 'Read only',
  'preset.workspaceWrite': 'Workspace write',
  'preset.fullAccess': 'Full access',
  'preset.custom': 'Custom',
  'preset.description.readOnly': 'Read only; approval is required before writing files or running external commands.',
  'preset.description.workspaceWrite': 'Write inside the workspace and permitted temporary directories; operations outside that scope require approval.',
  'preset.description.fullAccess': 'Access all files without approval prompts.',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>
