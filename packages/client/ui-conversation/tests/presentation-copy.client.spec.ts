import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en, zh } from '../src/client/locales.ts'
import {
  accessModeDescription, accessModeLabel, approvalReason,
} from '../src/client/presentation-copy.ts'

const zhT = makeTranslate(zh, commonZh)
const enT = makeTranslate(en, commonEn)

describe('localized conversation presentation copy', () => {
  it('localizes built-in access modes and preserves deployment-defined modes', () => {
    expect(accessModeLabel('workspace-write', 'Workspace Write', zhT)).toBe('工作区写入')
    expect(accessModeDescription('workspace-write', 'host copy', zhT))
      .toContain('超出范围的操作需要审批')
    expect(accessModeLabel('company-review', '企业审查', enT)).toBe('企业审查')
    expect(accessModeDescription('company-review', 'Custom host copy', enT)).toBe('Custom host copy')
  })

  it('localizes first-party approval envelopes without rewriting free-form policy reasons', () => {
    expect(approvalReason('escalate sandbox to danger-full-access: install the package', zhT))
      .toBe('请求将执行权限提升至“完全访问”：install the package')
    expect(approvalReason('个人本地长期记忆 新增: prefers compact replies', enT))
      .toBe('Personal local memory requests to add an entry: prefers compact replies')
    expect(approvalReason('企业安全策略要求人工确认', enT)).toBe('企业安全策略要求人工确认')
  })
})
