import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop window lifecycle', () => {
  it('keeps the login window alive until the replacement window is visible', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const accepted = source.indexOf('resolveGate({')
    const mainShown = source.indexOf('mainWindow.show()')
    const loginClosed = source.indexOf('gate.closeLoginWindow()')

    expect(accepted).toBeGreaterThan(-1)
    expect(mainShown).toBeGreaterThan(accepted)
    expect(loginClosed).toBeGreaterThan(mainShown)
    expect(source).toContain('closeLoginWindow: () =>')
  })

  it('records startup phases without writing the API Key to diagnostics', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(source).toContain('模型访问校验成功')
    expect(source).toContain('主窗口已显示')
    expect(source).toContain('后端已就绪')
    expect(source).not.toMatch(/recordDesktopEvent\([^\n]*gate\.apiKey/)
  })

  it('preserves a Hub-authorized one-time key when the model gateway rejects it', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const handlerStart = source.indexOf('const handleSavedKeyFailure')
    const handlerEnd = source.indexOf('const verifySavedKey', handlerStart)
    const failureHandler = source.slice(handlerStart, handlerEnd)
    const invalidBranch = source.indexOf("response.code === 'INVALID_MODEL_KEY'")
    const transientBranch = source.indexOf('临时服务错误')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)
    expect(invalidBranch).toBeGreaterThan(-1)
    expect(transientBranch).toBeGreaterThan(invalidBranch)
    expect(failureHandler).toContain('凭据继续保留')
    expect(failureHandler).not.toContain('credentialStore.clear()')
  })

  it('checks Hub authorization before loading a cached API Key', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const resolveCall = source.indexOf('const resolution = await aiHubClient.resolveKey()')
    const cacheLoad = source.indexOf('credentialStore.load(authenticatedWorkcode, resolution.applicationId)')

    expect(resolveCall).toBeGreaterThan(-1)
    expect(cacheLoad).toBeGreaterThan(resolveCall)
    expect(source).toContain("resolution.state === 'application-required'")
    expect(source).toContain('await credentialStore.clear()')
  })

  it('keeps the legacy user-data path before acquiring the single-instance lock', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const stablePath = source.indexOf("app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness'))")
    const stablePathCall = source.lastIndexOf('configureStableUserDataPath()')
    const lock = source.indexOf('app.requestSingleInstanceLock()')

    expect(stablePath).toBeGreaterThan(-1)
    expect(stablePathCall).toBeGreaterThan(stablePath)
    expect(lock).toBeGreaterThan(stablePathCall)
  })

  it('switches the runtime application icon with the operating-system theme', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(source).toContain("nativeTheme.on('updated', update)")
    expect(source).toContain("nativeTheme.shouldUseDarkColors ? 'dark' : 'light'")
    expect(source).toContain("join(process.resourcesPath, 'icons', filename)")
    expect(source).toContain('app.dock?.setIcon(icon)')
    expect(source).toContain('window.setIcon(icon)')
    expect(source).toContain('icon: options.icon ?? applicationIconPath()')
  })

  it('keeps the local Web surface behind an Electron-only per-run token', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const patch = await readFile(new URL('../config/desktop.patch.yml', import.meta.url), 'utf8')
    const tokenCreation = source.indexOf("const localWebAccessToken = randomUUID().replaceAll('-', '')")
    const headerInstallation = source.indexOf('installLocalWebAccess(mainWindow, url, localWebAccessToken)')
    const pageLoad = source.indexOf('await mainWindow.loadURL(url)')

    expect(tokenCreation).toBeGreaterThan(-1)
    expect(headerInstallation).toBeGreaterThan(tokenCreation)
    expect(pageLoad).toBeGreaterThan(headerInstallation)
    expect(source).toContain('[DESKTOP_WEB_ACCESS_TOKEN_ENV]: localWebAccessToken')
    expect(source).toContain('partition: `harness-runtime-${randomUUID()}`')
    expect(source).toContain('Authorization: `Bearer ${token}`')
    expect(source).toContain("target.protocol === 'http:' || target.protocol === 'ws:'")
    expect(patch).toMatch(/id: webserver[\s\S]*host: 127\.0\.0\.1[\s\S]*port: 0[\s\S]*accessTokenEnv: DSH_DESKTOP_WEB_ACCESS_TOKEN/)
    expect(source).not.toMatch(/recordDesktopEvent\([^\n]*localWebAccessToken/)
  })

  it('marks a managed generation healthy only after the renderer loader settles', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../renderer/main-preload.cjs', import.meta.url), 'utf8')
    const boot = await readFile(
      new URL('../../../packages/client/web/src/boot.tsx', import.meta.url),
      'utf8',
    )
    const wait = source.indexOf('await healthPromise')
    const healthy = source.indexOf('await recovery.markHealthy()')

    expect(source).toContain("const BOOT_HEALTH_CHANNEL = 'desktop:boot-health'")
    expect(preload).toContain("window.addEventListener('dsh:desktop-boot-health'")
    expect(boot).toContain("export const DESKTOP_BOOT_HEALTH_EVENT = 'dsh:desktop-boot-health'")
    expect(boot).toContain('reportDesktopBootHealth({')
    expect(wait).toBeGreaterThan(-1)
    expect(healthy).toBeGreaterThan(wait)
    expect(source).toContain('await recovery.rollback()')
  })

  it('offers a compact tray for status, updates, diagnostics and exit', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(source).toContain("label: english ? 'Open workspace' : '打开工作台'")
    expect(source).toContain("label: english ? 'Export diagnostics...' : '导出诊断包...'")
    expect(source).toContain('click: () => { void openManagedUpdatePrompt() }')
    expect(source).toContain("label: english ? 'Quit' : '退出'")
    expect(source).toContain("mainWindow.on('close'")
    expect(source).toContain('mainWindow.hide()')
  })

  it('revokes the enterprise session and returns to login without exposing credentials', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const handlerStart = source.indexOf('function registerEnterpriseAccountHandlers(')
    const handlerEnd = source.indexOf('function registerManagedUpdateHandlers(', handlerStart)
    const handler = source.slice(handlerStart, handlerEnd)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)
    expect(handler).toContain('assertSender(event.sender.id)')
    expect(handler).toContain('const account = readAccount()')
    expect(handler).toContain('await revokeSession()')
    expect(handler).toContain('app.relaunch()')
    expect(handler).toContain('app.quit()')
    expect(handler).not.toContain('accessToken:')
    expect(handler).not.toContain('refreshToken:')
  })

  it('loads Hub plug-ins from the profile module-resolution tree', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const cliPackage = JSON.parse(await readFile(
      new URL('../../cli/package.json', import.meta.url),
      'utf8',
    )) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }

    expect(source).toContain('const managedPluginDir = resolveManagedPluginRoot(harnessHome)')
    expect(source).toContain("const legacyManagedPluginDir = join(harnessHome, 'hub-plugins')")
    expect(source).toContain('await rm(legacyManagedPluginDir, { recursive: true, force: true })')
    expect(cliPackage.dependencies).toHaveProperty('@deepseek-ai/dsh-tools')
    expect(cliPackage.devDependencies).not.toHaveProperty('@deepseek-ai/dsh-tools')
  })

  it('hot-loads Hub plug-in, Skill, instruction, and Gateway catalog changes', async () => {
    const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(source).toContain('const skillsChanged = latestRevisions.skills !== revisions.skills')
    expect(source).toContain('const gatewayChanged = latestRevisions.gateway !== revisions.gateway')
    expect(source).toContain('if (!activationChanged && !gatewayChanged && !skillsChanged && !instructionsChanged)')
    expect(source).toContain('await waitForManagedPluginHotReload(')
    expect(source).toContain('snapshot: catalogSnapshot(latest)')
    expect(source).toContain('企业能力已在后台生效，无需重启客户端')
  })
})
