import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const documents: JSDOM[] = []

async function loginPage(language: 'zh' | 'en', login = vi.fn()): Promise<JSDOM> {
  const [html, script] = await Promise.all([
    readFile(new URL('../renderer/login.html', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/login.js', import.meta.url), 'utf8'),
  ])
  const dom = new JSDOM(html, {
    url: `https://desktop.invalid/login.html?language=${language}`,
    runScripts: 'outside-only',
  })
  documents.push(dom)
  Object.assign(dom.window, {
    desktopAuth: {
      login,
      retrySavedModelKey: vi.fn(),
      requestHubKey: vi.fn(),
    },
  })
  new Script(script).runInContext(dom.getInternalVMContext())
  return dom
}

afterEach(() => {
  vi.useRealTimers()
  for (const document of documents.splice(0)) document.window.close()
})

describe('desktop login language', () => {
  it('renders the initial query language and switches visible copy immediately', async () => {
    const dom = await loginPage('zh')
    const { document } = dom.window

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.querySelector('#login-title')?.textContent).toBe('登录')
    expect(document.querySelector('.product-subtitle')?.textContent).toBe('企业智能工作台')
    document.querySelector<HTMLButtonElement>('[data-language="en"]')?.click()
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Sign in - Harness Enterprise Desktop')
    expect(document.querySelector('#login-title')?.textContent).toBe('Sign in')
    expect(document.querySelector('.product-subtitle')?.textContent).toBe('Enterprise intelligent workspace')
    expect(document.querySelector('footer')?.textContent).toBe('Enterprise identity verification')
    expect([...document.querySelectorAll('[data-language="en"]')]
      .every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true)
  })

  it('submits the selected language and relocalizes a stable-code error', async () => {
    const login = vi.fn().mockResolvedValue({ ok: false, code: 'INVALID_CREDENTIALS' })
    const dom = await loginPage('en', login)
    const { document, Event } = dom.window
    const workcode = document.querySelector<HTMLInputElement>('#workcode')
    const password = document.querySelector<HTMLInputElement>('#password')
    if (workcode === null || password === null) throw new Error('login fields are missing')
    workcode.value = '100001'
    password.value = 'secret'

    document.querySelector<HTMLFormElement>('#login-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledWith({ workcode: '100001', password: 'secret', language: 'en' })
      expect(document.querySelector('#feedback')?.textContent).toBe('The workcode or password is incorrect.')
    })

    document.querySelector<HTMLButtonElement>('[data-language="zh"]')?.click()
    expect(document.querySelector('#feedback')?.textContent).toBe('工号或密码不正确。')
  })

  it('automatically dismisses a validation error', async () => {
    vi.useFakeTimers()
    const dom = await loginPage('zh')
    const { document, Event } = dom.window
    const feedback = document.querySelector<HTMLElement>('#feedback')
    document.querySelector<HTMLFormElement>('#login-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(feedback?.hidden).toBe(false)
    expect(feedback?.textContent).toBe('请输入工号')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(feedback?.hidden).toBe(true)
  })
})
