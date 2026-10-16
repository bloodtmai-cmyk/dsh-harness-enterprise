// Trusted non-loopback Web access cannot call the loopback-only settings API;
// the notice therefore advances for this browser process and returns on reload.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'

const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const address = Object.values(networkInterfaces()).flat()
      .find(candidate => candidate?.family === 'IPv4' && !candidate.internal)?.address
    if (address === undefined) throw new Error('LAN HTTP regression requires a local non-loopback IPv4 interface')
    scaffold = await launchWebScaffold({
      remoteAuthority: address,
      listenHost: '0.0.0.0',
      welcomeNoticePending: true,
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch({
      ...(executablePath === undefined ? {} : { executablePath }),
      args: ['--no-proxy-server'],
    })
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('advances process-locally and presents the notice again after reload', async () => {
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('explains privileged configuration access in the assembled settings page', async () => {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    const notice = dialog.getByRole('status')
    await expect.poll(() => notice.textContent()).toContain('仅限服务器本机访问')
    expect(await notice.textContent()).toContain('SSH')
    const snapshot = await captureStableAria(page, '[role="dialog"] [role="status"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./snapshots/remote-access/notice.expected.md', import.meta.url)), snapshot, MODE,
    )
    const denial = await page.evaluate(async () => {
      const response = await fetch('/api/settings.describe', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      return { status: response.status, body: await response.json() as unknown }
    })
    expect(denial.status).toBe(403)
    expect(denial.body).toMatchObject({ code: 'loopback-required' })
    expect(tripwire.pageErrors).toEqual([])
  })
})
