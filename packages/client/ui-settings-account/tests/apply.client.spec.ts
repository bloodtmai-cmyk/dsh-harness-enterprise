// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'

afterEach(() => {
  delete window.desktopEnterpriseAccount
})

function context() {
  const register = vi.fn().mockReturnValue(() => {})
  const inject = vi.fn((_name: string, install: () => unknown) => install())
  const localeRegister = vi.fn().mockReturnValue(() => {})
  const ctx = {
    effect: vi.fn((install: () => unknown) => install()),
    locale: { register: localeRegister, bind: vi.fn(() => (key: string) => key) },
    slots: { inject, register },
  } as unknown as ClientContext
  return { ctx, inject, localeRegister, register }
}

describe('enterprise account Settings registration', () => {
  it('stays absent in a browser without the privileged Electron bridge', () => {
    const fixture = context()
    apply(fixture.ctx)
    expect(fixture.localeRegister).not.toHaveBeenCalled()
    expect(fixture.inject).not.toHaveBeenCalled()
  })

  it('registers the first Settings section only after the Electron bridge is present', () => {
    window.desktopEnterpriseAccount = {
      state: vi.fn(),
      logout: vi.fn(),
    }
    const fixture = context()
    apply(fixture.ctx)

    expect(fixture.localeRegister).toHaveBeenCalledOnce()
    expect(fixture.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(fixture.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.section', id: 'personal', order: 5 }),
      expect.any(Function),
    )
  })
})
