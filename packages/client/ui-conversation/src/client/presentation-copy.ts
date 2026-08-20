import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

type ConversationTranslate = TranslateNS<'conversation'>

const MEMORY_ACTION_KEYS = {
  '新增': 'approval.memoryAction.add',
  '更新': 'approval.memoryAction.update',
  '删除': 'approval.memoryAction.delete',
  '清空': 'approval.memoryAction.clear',
} as const

/** Localize a built-in permission preset while preserving deployment-defined labels. */
export function accessModeLabel(value: string, fallback: string, t: ConversationTranslate): string {
  switch (value) {
    case 'read-only': return t('access.mode.readOnly')
    case 'workspace-write': return t('access.mode.workspaceWrite')
    case 'danger-full-access': return t('access.mode.fullAccess')
    case 'custom': return t('access.mode.custom')
    default: return fallback
  }
}

/** Localize a built-in permission description while preserving deployment-defined copy. */
export function accessModeDescription(
  value: string,
  fallback: string | undefined,
  t: ConversationTranslate,
): string | undefined {
  switch (value) {
    case 'read-only': return t('access.description.readOnly')
    case 'workspace-write': return t('access.description.workspaceWrite')
    case 'danger-full-access': return t('access.description.fullAccess')
    default: return fallback
  }
}

/** Localize stable first-party approval envelopes; free-form policy text stays verbatim. */
export function approvalReason(reason: string | undefined, t: ConversationTranslate): string | undefined {
  if (reason === undefined) return undefined
  const escalation = /^escalate sandbox to "?([^":]+)"?:\s*([\s\S]+)$/.exec(reason)
  if (escalation !== null) {
    const mode = escalation[1] ?? ''
    const justification = escalation[2] ?? ''
    return t('approval.sandboxEscalation', {
      mode: accessModeLabel(mode, mode, t),
      justification,
    })
  }
  const memory = /^个人本地长期记忆\s+(新增|更新|删除|清空):\s*([\s\S]*)$/.exec(reason)
  if (memory !== null) {
    const action = memory[1] as keyof typeof MEMORY_ACTION_KEYS
    return t('approval.memoryWrite', {
      action: t(MEMORY_ACTION_KEYS[action]),
      summary: memory[2] ?? '',
    })
  }
  return reason
}
