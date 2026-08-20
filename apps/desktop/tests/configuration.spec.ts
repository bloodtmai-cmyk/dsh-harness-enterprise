import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverOpenAiCompatibleModels,
  loadDesktopConfig,
  MANAGED_AI_HUB_BASE_URL,
  mergeEnvironment,
  normalizeOpenAiBaseURL,
  selectDefaultModel,
} from '../src/configuration.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })))
})

describe('desktop environment', () => {
  it('keeps inherited values above project and user fallbacks', () => {
    expect(mergeEnvironment(
      { SHARED: 'process' },
      { SHARED: 'project', PROJECT: 'yes' },
      { SHARED: 'user', USER: 'yes' },
    )).toMatchObject({ SHARED: 'process', PROJECT: 'yes', USER: 'yes' })
  })

  it('uses Hub-supplied model access and trusted MCP deployment settings', () => {
    expect(MANAGED_AI_HUB_BASE_URL).toBe('http://127.0.0.1:8090/ai-hub')
    expect(normalizeOpenAiBaseURL('http://gateway:4000')).toBe('http://gateway:4000/v1')
    expect(loadDesktopConfig({
      DSH_DESKTOP_MCP_URL: 'https://workbuddy.example/mcp',
      DSH_DESKTOP_MCP_NAME: 'workbuddy',
      DSH_DESKTOP_MCP_HEADERS_JSON: '{"X-Tenant":"030"}',
    }, 'key', 'https://models.example.com')).toMatchObject({
      modelGatewayBaseURL: 'https://models.example.com/v1',
      modelApiKey: 'key',
      mcp: {
        url: 'https://workbuddy.example/mcp',
        serverName: 'workbuddy',
      },
    })
  })

  it('pins the desktop directory picker to the in-app backend', async () => {
    const patch = await readFile(new URL('../config/desktop.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain("name: '@deepseek-ai/dsh-host-directory-picker-browse'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'")
    expect(patch).toMatch(/id: directory-picker\n\s+disabled: true/)
  })

  it('enforces the AI Hub governed desktop plug-in policy', async () => {
    const patch = await readFile(new URL('../config/desktop.patch.yml', import.meta.url), 'utf8')
    const webPatch = await readFile(
      new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url),
      'utf8',
    )
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const standardPreset = await readFile(
      new URL('../../cli/config/agent-presets/standard/agent.cordis.yml', import.meta.url),
      'utf8',
    )

    for (const id of [
      'ui-settings-plugins',
      'ui-settings-plugin-inventory',
      'ui-agent-preset',
      'cordis-host-runner',
      'cordis-client-runner',
      'ui-cordis',
      'web-search-deepseek',
      'session-telemetry-otel',
    ]) {
      expect(patch).toMatch(new RegExp(`id: ${id}\\n\\s+disabled: true`))
    }
    expect(patch).toMatch(/id: agent-presets[\s\S]*default: standard[\s\S]*includeUserRoot: false[\s\S]*allowUserDefault: false/)
    expect(patch).toMatch(/id: agent-loop[\s\S]*maxStepsPerTurn: 24[\s\S]*maxRequestAttemptsPerStep: 4[\s\S]*maxTokensPerTurn: 500000/)
    expect(patch).toMatch(/id: api-gateway[\s\S]*settingsDocumentOpen: false/)
    expect(patch).toMatch(/id: api-gateway[\s\S]*settingsNamespaceAllowlist:[\s\S]*- locale[\s\S]*- ui-conversation[\s\S]*- ui-theme/)
    expect(patch).not.toMatch(/settingsNamespaceAllowlist:[\s\S]*- permission/)
    expect(patch).not.toContain('desktop-agent-reach')
    expect(patch).not.toContain('mcp.exa.ai')
    expect(webPatch).toMatch(/id: agent-instructions\n\s+disabled: true/)
    expect(patch).toMatch(/id: agent-instructions[\s\S]*disabled: false[\s\S]*maxBytes: 0/)
    expect(patch).toMatch(/id: agent-instructions[\s\S]*DSH_HUB_AGENTS_FILE[\s\S]*DSH_HUB_AGENTS_SHA256_FILE/)
    expect(patch).toMatch(/id: skill-filesystem[\s\S]*customSkillDirs:[\s\S]*DSH_HUB_SKILL_DIR/)
    expect(patch).toMatch(/id: session-audit-ai-hub[\s\S]*DSH_AI_HUB_BASE_URL[\s\S]*DSH_CLIENT_INSTALLATION_ID/)
    expect(patch).toMatch(/id: sandbox-policy[\s\S]*mode: workspace-write[\s\S]*workspaceRoot:/)
    expect(patch).toMatch(/id: personal-memory-local[\s\S]*tokenBrokerURL:[\s\S]*maxPromptEntries: 8[\s\S]*maxQueryResults: 5/)
    expect(patch).not.toContain('disabled: !!js process.env.DSH_PERSONAL_MEMORY_ENABLED')
    expect(patch).toContain("name: '@deepseek-ai/dsh-client-ui-settings-personal-memory'")
    expect(webPatch).toContain("name: '@deepseek-ai/dsh-client-ui-settings-account'")
    expect(patch).not.toMatch(/id: desktop-workbuddy-mcp[\s\S]*disabled: !!js process\.env\.DSH_DESKTOP_WORKBUDDY_ENABLED !== 'true'/)
    expect(patch).toMatch(/id: desktop-workbuddy-mcp[\s\S]*serverName: workbuddy[\s\S]*bearerTokenBroker:/)
    expect(patch).toMatch(/id: desktop-workbuddy-mcp[\s\S]*toolGuidance:[\s\S]*Never ask the user for a workcode or password/)
    expect(patch).not.toContain('jsonErrorMessages:')
    expect(patch).not.toContain('desktop-custom-mcp')
    expect(main).toContain('oauthClient.authenticate(payload.workcode, payload.password)')
    expect(main).toContain('const weComAuthManager = new WeComSkillAuthManager(')
    expect(main).toContain('startWorkBuddyTokenBroker(')
    expect(main).toContain('weComAuthManager,')
    expect(main).not.toContain('authenticateDirectory')
    expect(packageJson.dependencies).not.toHaveProperty('ldapts')
    expect(main).toContain("DSH_MANAGED_PROFILE: '1'")
    expect(main).toContain('DSH_MANAGED_HOT_PATCH:')
    expect(main).toContain('DSH_MANAGED_HOT_STATUS:')
    expect(main).toContain("DSH_PERMISSION_MODE: 'workspace-write'")
    expect(main).toContain("DSH_WEB_SEARCH_DISABLED: '1'")
    expect(standardPreset).toContain("search: !!js process.env.DSH_WEB_SEARCH_DISABLED !== '1'")
  })

  it('packages Windows without the fragile ZIP extraction plug-in', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
      build: {
        nsis: { useZip: boolean }
        win: { electronLanguages: string[]; files: string[] }
      }
    }
    const installer = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(packageJson.build.nsis.useZip).toBe(false)
    expect(packageJson.dependencies['electron-updater']).toBe('6.8.9')
    expect(packageJson.build.win.electronLanguages).toEqual(['en-US', 'zh-CN'])
    expect(packageJson.build.win.files).toContain('!node_modules/@img/sharp-libvips-darwin-*/**/*')
    expect(packageJson.build.win.files).toContain('!node_modules/@vscode/ripgrep-win32-arm64/**/*')
    expect(installer).toContain('!define APP_BUILD_DIR')
    expect(installer).toContain('win-unpacked')
    expect(installer).toContain('!macro repairInterruptedInstaller')
    const view64 = installer.indexOf('SetRegView 64')
    const view32 = installer.indexOf('SetRegView 32')
    const repairCalls = [...installer.matchAll(/!insertmacro repairInterruptedInstaller/g)]
      .map(match => match.index)
    expect(repairCalls).toHaveLength(2)
    expect(view64).toBeLessThan(repairCalls[0]!)
    expect(repairCalls[0]!).toBeLessThan(view32)
    expect(view32).toBeLessThan(repairCalls[1]!)
    expect(installer).toContain('0.1.0-rc.5')
    expect(installer).toContain('0.1.0-rc.6')
    expect(main).toContain("import('electron-updater')")
    expect(main).toContain('new NsisUpdater({')
    expect(main).toContain("channel: 'latest'")
    expect(main).toContain('updater.disableDifferentialDownload = true')
    expect(main).toContain('updater.quitAndInstall(true, true)')
    expect(main).toContain('const DESKTOP_UPDATE_INITIAL_DELAY_MS = 3_000')
    expect(main).toContain('const DESKTOP_UPDATE_INTERVAL_MS = 5 * 60_000')
    expect(main).toContain('scheduleDesktopUpdateChecks(options.mainWindow, check)')
    expect(main).toContain("mainWindow.on('focus', onFocus)")
    expect(main).toContain('Windows 客户端版本检查完成: current=')
  })

  it('keeps Harness upgrades user-driven while managed capabilities hot-apply', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../renderer/main-preload.cjs', import.meta.url), 'utf8')

    expect(main).toContain("const MANAGED_UPDATE_STATE_CHANNEL = 'desktop:managed-update-state'")
    expect(main).toContain("['Cancel', 'Update silently on next launch', 'Download and restart now']")
    expect(main).toContain('writeDesktopUpdateSchedule')
    expect(main).toContain('catalogActivationChanges(activeCatalog, latest)')
    expect(main).toContain('waitForManagedPluginHotReload')
    expect(main).toContain('scheduleActivation(latestRevisions.activation)')
    expect(main).not.toContain('Enterprise changes ready')
    expect(preload).toContain("exposeInMainWorld('desktopManagedUpdates'")
    expect(preload).not.toContain('desktopCapabilityUpdates')
  })

  it('keeps managed background commands hidden on Windows', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const weCom = await readFile(new URL('../src/wecom-skill-auth.ts', import.meta.url), 'utf8')
    const subprocess = await readFile(
      new URL('../../../packages/subprocess/subprocess-local/src/spawn.ts', import.meta.url),
      'utf8',
    )
    const inspector = await readFile(
      new URL('../../../packages/subprocess/subprocess-local/src/process-inspector.ts', import.meta.url),
      'utf8',
    )

    expect(main).toMatch(/spawn\(process\.execPath,[\s\S]*windowsHide: true/)
    expect(weCom.match(/windowsHide: true/g)).toHaveLength(2)
    expect(subprocess).toMatch(/spawn\(program, args,[\s\S]*windowsHide: true/)
    expect(subprocess).toMatch(/spawnSync\('taskkill',[\s\S]*windowsHide: true/)
    expect(inspector).toContain("execFileSync(file, args, { encoding: 'utf8', windowsHide: true })")
  })

  it('ships the official WeCom runtime and the managed Skill setup bridge', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const preload = await readFile(new URL('../renderer/main-preload.cjs', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(packageJson.dependencies['@wecom/cli']).toBe('1.1.0')
    expect(preload).toContain("exposeInMainWorld('desktopManagedSkillSetup'")
    expect(preload).toContain("ipcRenderer.invoke('desktop:managed-skill-setup-start'")
    expect(main).toContain('registerManagedSkillSetupHandlers(mainWindow, weComAuthManager)')
    expect(main).toContain('resolveWeComCliPath()')
    const patch = await readFile(new URL('../config/desktop.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('includeDefaultRoots: false')
  })

  it('uses the managed DSH product identity and bundled login visuals', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      build: {
        afterPack: string
        appId: string
        productName: string
        extraResources: Array<{ from: string; to: string }>
        mac: { icon: string }
        win: { artifactName: string; icon: string }
        nsis: { shortcutName: string }
      }
      scripts: Record<string, string>
    }
    const login = await readFile(new URL('../renderer/login.html', import.meta.url), 'utf8')
    const loginScript = await readFile(new URL('../renderer/login.js', import.meta.url), 'utf8')
    const ambientScript = await readFile(new URL('../renderer/ambient.js', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(packageJson.build.productName).toBe('Harness Enterprise Desktop')
    expect(packageJson.build.win.artifactName).toContain('DSH-Harness-Setup')
    expect(packageJson.build.nsis.shortcutName).toBe('Harness Enterprise Desktop')
    expect(packageJson.build.appId).toBe('ai.deepseek.harness.desktop')
    expect(packageJson.build.afterPack).toBe('scripts/verify-packaged-runtime.cjs')
    expect(packageJson.build.mac.icon).toBe('build/icons/app-icon-light.png')
    expect(packageJson.build.win.icon).toBe('build/icons/app-icon-light.png')
    expect(packageJson.build.extraResources).toContainEqual({ from: 'build/icons', to: 'icons' })
    expect(packageJson.scripts['pack:mac:built']).toContain('generate:icons')
    expect(packageJson.scripts['pack:win:built']).toContain('generate:icons')
    expect(login).toContain('<title>登录 - Harness Enterprise Desktop</title>')
    expect(login).not.toContain('./assets/deepseek-logo.svg')
    expect(login).not.toContain('aria-label="DeepSeek Harness"')
    expect(login.match(/class="harness-badge product-harness-badge"/g)).toHaveLength(2)
    expect(login).not.toContain('class="product-mark"')
    expect(login.match(/class="panel-heading"/g)).toHaveLength(2)
    expect(login).not.toContain('class="panel-actions"')
    expect(login).toContain('<canvas id="ambient-canvas" class="panel-ambient" aria-hidden="true"></canvas>')
    expect(loginScript).toContain('keyPanel.prepend(ambientCanvas)')
    expect(login).toContain('<script src="./ambient.js" defer></script>')
    expect(ambientScript).toContain('requestAnimationFrame(tick)')
    expect(ambientScript).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(ambientScript).toContain("window.addEventListener('pointermove'")
    expect(login).toContain('./assets/hero-whale.svg')
    expect(login).toContain('data-language="zh"')
    expect(login).toContain('data-language="en"')
    expect(login).toContain("font-src 'self'")
    expect(loginScript).toContain('login({ workcode, password, language })')
    expect(loginScript).toContain("requestHubKey({ action: keyMode === 'application' ? 'apply' : 'retry', language })")
    expect(login).not.toContain('id="api-key"')
    expect(main).toContain("DSH_OUTPUT_LANGUAGE_FROM_LOCALE: '1'")
    expect(main).toContain('loadFile(loginPagePath(), { query: { language: initialLanguage } })')
    expect(main).toContain("mainWindow.on('page-title-updated'")
    expect(main).toContain("mainWindow.setTitle('Harness Enterprise Desktop')")
    expect(main).toContain('app.setName(PRODUCT_NAME)')
    expect(main).toContain('registerExternalNavigation(mainWindow, gate.language)')
    expect(main).toContain('shell.openExternal(target)')
    expect(main).not.toContain("title: 'DeepSeek Harness")
  })

  it('ships the constrained desktop file-preview bridge', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      build: { files: string[] }
    }
    const preload = await readFile(new URL('../renderer/main-preload.cjs', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(packageJson.build.files).toContain('renderer/**/*')
    expect(preload).toContain("contextBridge.exposeInMainWorld('desktopPreview'")
    expect(preload).toContain("contextBridge.exposeInMainWorld('desktopAttachments'")
    expect(preload).toContain("ipcRenderer.invoke('desktop:preview-read'")
    expect(main).toContain('resolveDesktopPreviewPath(request)')
    expect(main).toContain('readDesktopPreviewFile(request)')
  })

  it('exposes the installed desktop version to the Settings About page', async () => {
    const preload = await readFile(new URL('../renderer/main-preload.cjs', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(main).toContain('additionalArguments: [`--dsh-desktop-version=${app.getVersion()}`]')
    expect(preload).toContain("contextBridge.exposeInMainWorld('desktopAppInfo'")
    expect(preload).toContain("productName: 'Harness Enterprise Desktop'")
    expect(preload).toContain('version: desktopVersion')
  })

  it('exposes only the sanitized enterprise profile and sign-out actions to Settings', async () => {
    const preload = await readFile(new URL('../renderer/main-preload.cjs', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const webPackage = JSON.parse(await readFile(
      new URL('../../../packages/bundle/web-app/package.json', import.meta.url),
      'utf8',
    )) as { dependencies: Record<string, string> }

    expect(webPackage.dependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-settings-account')
    expect(preload).toContain("exposeInMainWorld('desktopEnterpriseAccount'")
    expect(preload).toContain("ipcRenderer.invoke('desktop:enterprise-account-state')")
    expect(preload).toContain("ipcRenderer.invoke('desktop:enterprise-account-logout')")
    expect(main).toContain('registerEnterpriseAccountHandlers(mainWindow, broker.account, broker.revoke, userData)')
    expect(main).toContain("const ENTERPRISE_ACCOUNT_STATE_CHANNEL = 'desktop:enterprise-account-state'")
    expect(main).toContain("const ENTERPRISE_ACCOUNT_LOGOUT_CHANNEL = 'desktop:enterprise-account-logout'")
  })
})

describe('OpenAI-compatible model gateway preflight', () => {
  it('reads unique model ids and picks an available default', async () => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      expect(request.url).toBe('/v1/models')
      expect(request.headers.authorization).toBe('Bearer key')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'glm-5.2' }, { id: 'deepseek-v4-flash' }, { id: 'glm-5.2' }] }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')

    const models = await discoverOpenAiCompatibleModels(`http://127.0.0.1:${address.port}/v1`, 'key')
    expect(models).toEqual(['glm-5.2', 'deepseek-v4-flash'])
    expect(selectDefaultModel(models)).toBe('deepseek-v4-flash')
    expect(() => selectDefaultModel(models, 'not-served')).toThrow(/不在模型网关返回的列表/)
  })
})
