// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseAccountSection } from '../src/client/EnterpriseAccountSection.tsx'
import type { EnterpriseAccountBridge, EnterpriseAccountProfile } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof zh): string => zh[key]
const profile: EnterpriseAccountProfile = {
  workcode: '1000001', providerId: 'ldap', displayName: '测试用户', department: '信息技术部',
  departmentCodes: ['0101'], jobTitle: '工程师', email: 'user@example.com', phone: '13800000000',
  sessionExpiresAt: '2026-08-20T12:00:00.000Z',
}

function bridge(overrides: Partial<EnterpriseAccountBridge> = {}): EnterpriseAccountBridge {
  return {
    state: vi.fn().mockResolvedValue({ ok: true, value: profile }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

describe('EnterpriseAccountSection', () => {
  it('shows only sanitized enterprise identity fields and no credentials', async () => {
    render(<EnterpriseAccountSection bridge={bridge()} t={t} />)

    expect(await screen.findAllByText('测试用户')).toHaveLength(2)
    expect(screen.getAllByText('1000001')).toHaveLength(2)
    expect(screen.getByText('LDAP 企业目录')).toBeTruthy()
    expect(screen.getByText('信息技术部')).toBeTruthy()
    expect(screen.getByText('0101')).toBeTruthy()
    expect(screen.getByText('user@example.com')).toBeTruthy()
    expect(screen.queryByText(/access token|refresh token|api key/i)).toBeNull()
  })

  it('omits LDAP attributes that were not present in the verified session', async () => {
    const minimal = { ...profile, providerId: 'oidc', displayName: undefined, department: undefined, departmentCodes: [], jobTitle: undefined, email: undefined, phone: undefined }
    render(<EnterpriseAccountSection bridge={bridge({ state: vi.fn().mockResolvedValue({ ok: true, value: minimal }) })} t={t} />)

    expect(await screen.findByText('企业用户')).toBeTruthy()
    expect(screen.getByText('企业单点登录')).toBeTruthy()
    expect(screen.queryByText('部门')).toBeNull()
    expect(screen.queryByText('邮箱')).toBeNull()
  })

  it('requires inline confirmation before ending the enterprise session', async () => {
    const logout = vi.fn().mockResolvedValue({ ok: true })
    render(<EnterpriseAccountSection bridge={bridge({ logout })} t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    expect(screen.getByText('确认退出当前账号？')).toBeTruthy()
    expect(logout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }))
    await waitFor(() => { expect(logout).toHaveBeenCalledOnce() })
    expect(screen.getByRole('button', { name: '正在退出...' })).toBeTruthy()
  })

  it('keeps the page available when sign-out or account loading fails', async () => {
    const api = bridge({ logout: vi.fn().mockResolvedValue({ ok: false, code: 'unavailable' }) })
    const view = render(<EnterpriseAccountSection bridge={api} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }))
    expect(await screen.findByText('退出失败，请稍后重试。')).toBeTruthy()

    view.unmount()
    const state = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'unavailable' })
      .mockResolvedValueOnce({ ok: true, value: profile })
    render(<EnterpriseAccountSection bridge={bridge({ state })} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: '重新加载' }))
    expect(await screen.findAllByText('测试用户')).toHaveLength(2)
  })
})
