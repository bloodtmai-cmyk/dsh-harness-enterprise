// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PersonalMemorySection } from '../src/client/PersonalMemorySection.tsx'
import type { PersonalMemoryBridge, PersonalMemoryState } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof zh): string => zh[key]
const empty: PersonalMemoryState = { enabled: false, entries: [] }

function bridge(overrides: Partial<PersonalMemoryBridge> = {}): PersonalMemoryBridge {
  return {
    state: vi.fn().mockResolvedValue({ ok: true, value: empty }),
    setEnabled: vi.fn().mockResolvedValue({ ok: true, value: { ...empty, enabled: true } }),
    remove: vi.fn().mockResolvedValue({ ok: true, value: empty }),
    clear: vi.fn().mockResolvedValue({ ok: true, value: empty }),
    ...overrides,
  }
}

describe('PersonalMemorySection', () => {
  it('hot-enables automatic personal memory without asking for a restart', async () => {
    const setEnabled = vi.fn().mockResolvedValue({ ok: true, value: { ...empty, enabled: true } })
    const api = bridge({ setEnabled })
    render(<PersonalMemorySection bridge={api} t={t} />)

    const toggle = await screen.findByRole('checkbox')
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith(true) })
    expect(await screen.findByText('已保存')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull()
  })

  it('reports a failed toggle without changing to a manual fallback', async () => {
    const api = bridge({ setEnabled: vi.fn().mockResolvedValue({ ok: false, code: 'unavailable' }) })
    render(<PersonalMemorySection bridge={api} t={t} />)

    fireEvent.click(await screen.findByRole('checkbox'))
    expect(await screen.findByText('操作失败，请稍后重试。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增记忆' })).toBeNull()
  })

  it('shows captured entries and keeps only destructive user controls', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, value: empty })
    const state: PersonalMemoryState = {
      enabled: true,
      entries: [{ id: 'm1', kind: 'PREFERENCE', title: '回答语言', summary: '答复使用中文', scope: 'GLOBAL', source: 'LOCAL_CONVERSATION', createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z' }],
    }
    render(<PersonalMemorySection bridge={bridge({ state: vi.fn().mockResolvedValue({ ok: true, value: state }), remove })} t={t} />)

    expect(await screen.findAllByText('答复使用中文')).toHaveLength(2)
    expect(screen.getByText('固定注入')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增记忆' })).toBeNull()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith('m1') })
  })

  it('labels automatically consolidated recent-work summaries and previews bounded recall', async () => {
    const state: PersonalMemoryState = {
      enabled: true,
      entries: [{ id: 'j1', kind: 'JOURNAL', title: '核对库存', summary: '目标：核对库存；结论：已完成', scope: 'WORKSPACE', source: 'LOCAL_CONVERSATION', createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z' }],
    }
    render(<PersonalMemorySection bridge={bridge({ state: vi.fn().mockResolvedValue({ ok: true, value: state }) })} t={t} />)

    expect(await screen.findByText('近期工作')).toBeTruthy()
    expect(screen.getByText('仅相关请求召回')).toBeTruthy()
    expect(screen.getAllByText('目标：核对库存；结论：已完成')).toHaveLength(2)
  })
})
