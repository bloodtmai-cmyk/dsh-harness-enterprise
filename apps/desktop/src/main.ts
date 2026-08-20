import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, session, shell, Tray } from 'electron'
import type { BrowserWindowConstructorOptions, IpcMainEvent, MenuItemConstructorOptions } from 'electron'
import type { NsisUpdater } from 'electron-updater'
import {
  discoverOpenAiCompatibleModels,
  loadDesktopConfig,
  MANAGED_AI_HUB_BASE_URL,
  mergeEnvironment,
  readEnvironmentFile,
  selectDefaultModel,
} from './configuration.ts'
import type { DesktopConfig } from './configuration.ts'
import {
  isCredentialRejection,
  WorkBuddyOAuthClient,
  WorkBuddyOAuthError,
} from './workbuddy-oauth.ts'
import type { WorkBuddyOAuthSession } from './workbuddy-oauth.ts'
import { startWorkBuddyTokenBroker } from './workbuddy-token-broker.ts'
import type { WorkBuddyAccountSnapshot, WorkBuddyTokenBroker } from './workbuddy-token-broker.ts'
import { ManagedModelCredentialStore, migrateManagedModelCredential } from './credential-store.ts'
import {
  AiHubClient,
  AiHubError,
  catalogActivationChanges,
  catalogRevisions,
  catalogSnapshot,
  deferRestartBoundCatalog,
  desktopReleasePlatform,
  resolveManagedPluginRoot,
} from './ai-hub-client.ts'
import type {
  HubCapabilityActivationChange,
  HubCapabilityType,
  HubCatalog,
  HubCatalogSyncResult,
  HubCatalogSnapshot,
  HubDesktopReleasePlatform,
} from './ai-hub-client.ts'
import {
  isDesktopLanguage,
  loadDesktopLanguage,
  persistDesktopLanguage,
  systemDesktopLanguage,
} from './desktop-language.ts'
import type { DesktopLanguage } from './desktop-language.ts'
import {
  DesktopPreviewError,
  readDesktopPreviewFile,
  resolveDesktopPreviewPath,
} from './file-preview.ts'
import type { DesktopPreviewRequest } from './file-preview.ts'
import {
  DesktopAttachmentOpenError,
  materializeDesktopAttachment,
  parseDesktopAttachmentOpenRequest,
} from './attachment-open.ts'
import { allowedExternalHttpUrl } from './external-navigation.ts'
import { PersonalMemoryStore } from './personal-memory-store.ts'
import {
  appendDesktopDiagnosticEvent,
  DesktopBootMarker,
  exportDesktopDiagnostics,
  rotateDesktopLogs,
} from './desktop-diagnostics.ts'
import { ManagedCapabilityRecovery } from './managed-capability-recovery.ts'
import { waitForManagedPluginHotReload } from './managed-plugin-hot-reload.ts'
import { inspectWindowsStorage } from './windows-storage.ts'
import {
  resolveWeComCliPath,
  isWeComCapabilityExternalRef,
  WeComSkillAuthManager,
} from './wecom-skill-auth.ts'

const require = createRequire(import.meta.url)
const PRODUCT_NAME = 'Harness Enterprise Desktop'
app.setName(PRODUCT_NAME)
const READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/
const DESKTOP_WEB_ACCESS_TOKEN_ENV = 'DSH_DESKTOP_WEB_ACCESS_TOKEN'
const AUTH_CHANNEL = 'desktop:authenticate'
const HUB_KEY_CHANNEL = 'desktop:request-hub-key'
const RETRY_SAVED_KEY_CHANNEL = 'desktop:retry-saved-model-key'
const PREVIEW_READ_CHANNEL = 'desktop:preview-read'
const PREVIEW_OPEN_EXTERNAL_CHANNEL = 'desktop:preview-open-external'
const ATTACHMENT_OPEN_CHANNEL = 'desktop:attachment-open'
const PERSONAL_MEMORY_STATE_CHANNEL = 'desktop:personal-memory-state'
const PERSONAL_MEMORY_ENABLE_CHANNEL = 'desktop:personal-memory-enable'
const PERSONAL_MEMORY_REMOVE_CHANNEL = 'desktop:personal-memory-remove'
const PERSONAL_MEMORY_CLEAR_CHANNEL = 'desktop:personal-memory-clear'
const ENTERPRISE_ACCOUNT_STATE_CHANNEL = 'desktop:enterprise-account-state'
const ENTERPRISE_ACCOUNT_LOGOUT_CHANNEL = 'desktop:enterprise-account-logout'
const MANAGED_UPDATE_STATE_CHANNEL = 'desktop:managed-update-state'
const MANAGED_UPDATE_OPEN_CHANNEL = 'desktop:managed-update-open'
const MANAGED_UPDATE_CHANGED_CHANNEL = 'desktop:managed-update-changed'
const MANAGED_SKILL_SETUP_STATE_CHANNEL = 'desktop:managed-skill-setup-state'
const MANAGED_SKILL_SETUP_START_CHANNEL = 'desktop:managed-skill-setup-start'
const MANAGED_SKILL_SETUP_CANCEL_CHANNEL = 'desktop:managed-skill-setup-cancel'
const MANAGED_SKILL_SETUP_CHANGED_CHANNEL = 'desktop:managed-skill-setup-changed'
const BOOT_HEALTH_CHANNEL = 'desktop:boot-health'
let backend: ChildProcess | undefined
const expectedBackendExits = new WeakSet<ChildProcess>()
let tokenBroker: WorkBuddyTokenBroker | undefined
let activeBootMarker: DesktopBootMarker | undefined
let desktopTray: Tray | undefined
let desktopTrayContext: { mainWindow: BrowserWindow; userData: string; language: DesktopLanguage } | undefined
let desktopHubStatus: 'connecting' | 'synced' | 'syncing' | 'failed' = 'connecting'
let capabilitySyncTimer: NodeJS.Timeout | undefined
let desktopUpdateTimer: NodeJS.Timeout | undefined
let desktopUpdateInitialTimer: NodeJS.Timeout | undefined
let quitting = false
const CAPABILITY_SYNC_INTERVAL_MS = 30_000
const DESKTOP_UPDATE_INITIAL_DELAY_MS = 3_000
const DESKTOP_UPDATE_INTERVAL_MS = 5 * 60_000
const DESKTOP_UPDATE_FOCUS_THROTTLE_MS = 60_000

type ManagedUpdateType = 'HARNESS' | Exclude<HubCapabilityType, 'INSTRUCTION'>
type ManagedUpdateStatus = 'none' | 'available' | 'scheduled' | 'downloading' | 'failed'
interface ManagedUpdateItem {
  type: ManagedUpdateType
  externalRef: string
  name: string
  fromVersion: string
  toVersion: string
  notes?: string
  action?: HubCapabilityActivationChange['action']
}
interface ManagedUpdateState {
  status: ManagedUpdateStatus
  updates: ManagedUpdateItem[]
}
interface ManagedUpdateActivation {
  restart: boolean
  handlesRestart?: boolean
  activate?: () => Promise<void> | void
  commit?: () => Promise<void> | void
}
interface ManagedUpdateOffer {
  id: string
  status: Exclude<ManagedUpdateStatus, 'none' | 'downloading'>
  updates: ManagedUpdateItem[]
  schedule: () => Promise<void>
  installNow: () => Promise<ManagedUpdateActivation>
}
interface ManagedUpdateContext {
  mainWindow: BrowserWindow
  userData: string
  language: DesktopLanguage
}
const managedUpdateOffers = new Map<string, ManagedUpdateOffer>()
let managedUpdateState: ManagedUpdateState = { status: 'none', updates: [] }
let managedUpdateContext: ManagedUpdateContext | undefined
let managedUpdateApplying = false
let managedUpdatePromptOpen = false

class LoginCancelledError extends Error {}

function loadingDocument(language: DesktopLanguage): string {
  const htmlLanguage = language === 'en' ? 'en' : 'zh-CN'
  const message = language === 'en'
    ? 'Checking the runtime and starting services...'
    : '正在检查运行环境并启动服务...'
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="${htmlLanguage}"><head><meta charset="utf-8"><title>Harness Enterprise Desktop</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#101214;color:#eef1f3;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}.status{display:flex;align-items:center;gap:12px}.spinner{width:18px;height:18px;border:2px solid #4b5258;border-top-color:#e9edf0;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="status"><span class="spinner"></span><span>${message}</span></div></body></html>`)}`
}

function hardenedWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    icon: options.icon ?? applicationIconPath(),
    webPreferences: {
      ...options.webPreferences,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

function registerExternalNavigation(window: BrowserWindow, language: DesktopLanguage): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = allowedExternalHttpUrl(url)
    if (target === undefined) return { action: 'deny' }

    void shell.openExternal(target).catch((error: unknown) => {
      if (window.isDestroyed()) return
      const detail = error instanceof Error ? error.message : String(error)
      void dialog.showMessageBox(window, {
        type: 'error',
        title: language === 'en' ? 'Unable to open link' : '无法打开链接',
        message: language === 'en'
          ? 'The download link could not be opened in your system browser.'
          : '无法使用系统浏览器打开下载链接。',
        detail,
        buttons: [language === 'en' ? 'OK' : '确定'],
      }).catch((dialogError: unknown) => {
        console.error('Failed to show the external-link error dialog', dialogError)
      })
    })
    return { action: 'deny' }
  })
}

function installLocalWebAccess(window: BrowserWindow, backendURL: string, token: string): void {
  const backend = new URL(backendURL)
  const webRequest = window.webContents.session.webRequest
  webRequest.onBeforeSendHeaders((details, callback) => {
    let authorizedOrigin = false
    try {
      const target = new URL(details.url)
      const protocolMatches = backend.protocol === 'https:'
        ? target.protocol === 'https:' || target.protocol === 'wss:'
        : target.protocol === 'http:' || target.protocol === 'ws:'
      authorizedOrigin = protocolMatches
        && target.hostname === backend.hostname
        && target.port === backend.port
    } catch {
      authorizedOrigin = false
    }
    callback({
      requestHeaders: authorizedOrigin
        ? { ...details.requestHeaders, Authorization: `Bearer ${token}` }
        : details.requestHeaders,
    })
  })
  window.once('closed', () => { webRequest.onBeforeSendHeaders(null) })
}

function applicationIconPath(): string {
  const filename = `app-icon-${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}.png`
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', filename)
    : resolve(app.getAppPath(), 'build', 'icons', filename)
}

function installThemeAwareApplicationIcon(): void {
  const update = (): void => {
    const icon = applicationIconPath()
    if (process.platform === 'darwin') {
      app.dock?.setIcon(icon)
      return
    }
    for (const window of BrowserWindow.getAllWindows()) window.setIcon(icon)
  }

  update()
  nativeTheme.on('updated', update)
}

function loginPreloadPath(): string {
  return join(app.getAppPath(), 'renderer', 'preload.cjs')
}

function mainPreloadPath(): string {
  return join(app.getAppPath(), 'renderer', 'main-preload.cjs')
}

function loginPagePath(): string {
  return join(app.getAppPath(), 'renderer', 'login.html')
}

interface GateResponse {
  ok: boolean
  code?: string
  message?: string
  diagnosticCode?: string
  retryAfterSeconds?: number
  nextStep?: 'hub-key' | 'launching' | 'retry-saved-key'
}

interface LaunchGateResult {
  apiKey: string
  modelProvider: string
  modelGatewayBaseURL: string
  models: string[]
  language: DesktopLanguage
  workBuddySession: WorkBuddyOAuthSession
  closeLoginWindow: () => void
}

function rateLimitedResult(waitSeconds: number): GateResponse {
  return {
    ok: false,
    code: 'RATE_LIMITED',
    message: `连续登录失败，请 ${waitSeconds} 秒后重试。`,
    retryAfterSeconds: waitSeconds,
  }
}

function publicModelGatewayError(error: unknown): GateResponse {
  const message = error instanceof Error ? error.message : ''
  if (/HTTP (?:401|403)/.test(message)) {
    return { ok: false, code: 'INVALID_MODEL_KEY', message: 'API Key 无效或没有模型访问权限。' }
  }
  return { ok: false, code: 'MODEL_GATEWAY_UNAVAILABLE', message: '模型服务暂不可用，请检查当前网络或稍后重试。' }
}

async function waitForLaunchGate(
  oauthClient: WorkBuddyOAuthClient,
  credentialStore: ManagedModelCredentialStore,
  userData: string,
  aiHubBaseURL: string,
  requestedModel: string,
): Promise<LaunchGateResult> {
  const settingsPath = join(userData, 'harness-home', 'settings.yaml')
  const initialLanguage = await loadDesktopLanguage(settingsPath, systemDesktopLanguage(app.getLocale()))
  const loginWindow = hardenedWindow({
    width: 480,
    height: 620,
    minWidth: 480,
    minHeight: 620,
    maxWidth: 480,
    maxHeight: 620,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '登录 - Harness Enterprise Desktop',
    autoHideMenuBar: true,
    backgroundColor: '#080d14',
    webPreferences: { preload: loginPreloadPath() },
  })
  let gatewayAuthenticated = false
  let completed = false
  let authInFlight = false
  let keyInFlight = false
  let failedAttempts = 0
  let blockedUntil = 0
  let authenticatedWorkcode: string | undefined
  let workBuddySession: WorkBuddyOAuthSession | undefined
  let authenticatedLanguage = initialLanguage
  let savedApiKey: string | undefined
  let savedApiKeyApplicationId: string | undefined
  let savedModelProvider: string | undefined
  let savedModelGatewayBaseURL: string | undefined
  let aiHubClient: AiHubClient | undefined

  loginWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  await loginWindow.loadFile(loginPagePath(), { query: { language: initialLanguage } })
  loginWindow.show()

  return new Promise<LaunchGateResult>((resolveGate, rejectGate) => {
    const removeHandlers = (): void => {
      ipcMain.removeHandler(AUTH_CHANNEL)
      ipcMain.removeHandler(HUB_KEY_CHANNEL)
      ipcMain.removeHandler(RETRY_SAVED_KEY_CHANNEL)
    }
    const completeGate = (
      apiKey: string,
      modelProvider: string,
      modelGatewayBaseURL: string,
      models: string[],
    ): void => {
      if (workBuddySession === undefined) throw new Error('MCP 登录会话缺失')
      completed = true
      removeHandlers()
      loginWindow.setClosable(false)
      resolveGate({
        apiKey,
        modelProvider,
        modelGatewayBaseURL,
        models,
        language: authenticatedLanguage,
        workBuddySession,
        closeLoginWindow: () => {
          if (!loginWindow.isDestroyed()) loginWindow.destroy()
        },
      })
    }
    const adoptLanguage = async (value: unknown): Promise<GateResponse | undefined> => {
      if (!isDesktopLanguage(value)) {
        return { ok: false, code: 'INVALID_LANGUAGE', message: '请选择有效语言。' }
      }
      try {
        await persistDesktopLanguage(settingsPath, value)
        authenticatedLanguage = value
        return undefined
      } catch {
        return { ok: false, code: 'LANGUAGE_SAVE_FAILED', message: '无法保存语言设置，请联系 IT 管理员。' }
      }
    }
    const handleSavedKeyFailure = async (error: unknown): Promise<GateResponse> => {
      const response = publicModelGatewayError(error)
      if (response.code === 'INVALID_MODEL_KEY') {
        await recordDesktopEvent(userData, 'AI Hub 下发的模型 API Key 被网关拒绝，凭据继续保留')
        return {
          ok: true,
          code: 'SAVED_KEY_REJECTED',
          nextStep: 'retry-saved-key',
          message: 'AI Hub 签发的 API Key 暂不可用，请联系管理员或稍后重试。',
        }
      }
      await recordDesktopEvent(userData, '已保存的 API Key 校验遇到临时服务错误，凭据继续保留')
      return {
        ok: true,
        code: 'SAVED_KEY_UNAVAILABLE',
        nextStep: 'retry-saved-key',
        message: '模型服务暂不可用，已保存的 API Key 会继续保留，请稍后重试。',
      }
    }
    const verifySavedKey = async (alreadyLocked = false): Promise<GateResponse> => {
      const apiKey = savedApiKey
      const provider = savedModelProvider
      const baseURL = savedModelGatewayBaseURL
      if (apiKey === undefined || provider === undefined || baseURL === undefined) {
        return { ok: true, nextStep: 'hub-key', code: 'KEY_APPLICATION_REQUIRED' }
      }
      if (!alreadyLocked && keyInFlight) return { ok: false, code: 'KEY_CHECK_IN_PROGRESS', message: '正在验证，请稍候。' }
      if (!alreadyLocked) keyInFlight = true
      try {
        const models = await discoverOpenAiCompatibleModels(baseURL, apiKey)
        completeGate(apiKey, provider, baseURL, models)
        return { ok: true, nextStep: 'launching' }
      } catch (error) {
        return await handleSavedKeyFailure(error)
      } finally {
        if (!alreadyLocked) keyInFlight = false
      }
    }
    const resolveHubKey = async (alreadyLocked = false): Promise<GateResponse> => {
      if (aiHubClient === undefined || authenticatedWorkcode === undefined) {
        return { ok: false, code: 'INVALID_AUTH_CONTEXT', message: '请先完成企业账号登录。' }
      }
      try {
        const resolution = await aiHubClient.resolveKey()
        if (resolution.state === 'pending') {
          savedApiKey = undefined
          savedApiKeyApplicationId = undefined
          savedModelProvider = undefined
          savedModelGatewayBaseURL = undefined
          await credentialStore.clear()
          return {
            ok: true,
            nextStep: 'hub-key',
            code: 'KEY_APPLICATION_PENDING',
            message: 'API Key 申请已提交，请等待管理员审批。',
          }
        }
        if (resolution.state === 'application-required') {
          savedApiKey = undefined
          savedApiKeyApplicationId = undefined
          savedModelProvider = undefined
          savedModelGatewayBaseURL = undefined
          await credentialStore.clear()
          return {
            ok: true,
            nextStep: 'hub-key',
            code: 'KEY_APPLICATION_REQUIRED',
            message: resolution.message ?? '尚未申请 API Key。',
          }
        }
        if (resolution.state === 'claimed-elsewhere') {
          savedModelProvider = resolution.provider
          savedModelGatewayBaseURL = resolution.baseUrl
          if (savedApiKeyApplicationId !== resolution.applicationId) {
            savedApiKey = await credentialStore.load(authenticatedWorkcode, resolution.applicationId)
            savedApiKeyApplicationId = savedApiKey === undefined ? undefined : resolution.applicationId
          }
          if (savedApiKey !== undefined) return await verifySavedKey(alreadyLocked)
          await credentialStore.clear()
          return {
            ok: true,
            nextStep: 'hub-key',
            code: 'KEY_ALREADY_CLAIMED',
            message: 'API Key 已领取，但本机没有保存的凭据，请联系管理员重新签发。',
          }
        }
        savedApiKey = resolution.key.apiKey
        savedApiKeyApplicationId = resolution.applicationId
        savedModelProvider = resolution.key.provider
        savedModelGatewayBaseURL = resolution.key.baseUrl
        const persisted = await credentialStore.save(authenticatedWorkcode, resolution.applicationId, savedApiKey)
        await recordDesktopEvent(
          userData,
          persisted ? '已从 AI Hub 领取 API Key 并写入操作系统安全存储' : '已从 AI Hub 领取 API Key，仅用于当前会话',
        )
        return await verifySavedKey(alreadyLocked)
      } catch (error) {
        const hubError = error instanceof AiHubError ? error : undefined
        return {
          ok: true,
          nextStep: 'hub-key',
          code: hubError?.code ?? 'AI_HUB_UNAVAILABLE',
          message: hubError?.message ?? 'AI Hub 暂不可用，请稍后重试。',
        }
      }
    }
    ipcMain.handle(AUTH_CHANNEL, async (event, request: unknown): Promise<GateResponse> => {
      if (event.sender !== loginWindow.webContents) {
        return { ok: false, code: 'INVALID_AUTH_CONTEXT', message: '登录上下文无效，请重新启动应用。' }
      }
      const now = Date.now()
      if (now < blockedUntil) return rateLimitedResult(Math.ceil((blockedUntil - now) / 1_000))
      if (authInFlight) return { ok: false, code: 'AUTH_IN_PROGRESS', message: '正在验证，请稍候。' }

      const payload = request !== null && typeof request === 'object'
        ? request as { workcode?: unknown; password?: unknown; language?: unknown }
        : {}
      authInFlight = true
      try {
        let result: WorkBuddyOAuthSession
        try {
          result = await oauthClient.authenticate(payload.workcode, payload.password)
        } catch (error) {
          if (error instanceof WorkBuddyOAuthError) {
            await recordDesktopEvent(userData, `企业账号登录失败，错误码 ${error.code}`).catch(() => {})
            if (isCredentialRejection(error)) {
              failedAttempts += 1
              if (failedAttempts >= 3) {
                failedAttempts = 0
                blockedUntil = Date.now() + 30_000
                return rateLimitedResult(30)
              }
            }
            return { ok: false, code: error.code, message: error.publicMessage }
          }
          await recordDesktopEvent(userData, '企业账号登录失败，错误码 UNKNOWN').catch(() => {})
          return { ok: false, code: 'WORKBUDDY_UNAVAILABLE', message: '企业账号登录服务暂不可用，请检查当前网络。' }
        }
        const languageError = await adoptLanguage(payload.language)
        if (languageError !== undefined) return languageError
        gatewayAuthenticated = true
        workBuddySession = result
        authenticatedWorkcode = result.workcode
        aiHubClient = new AiHubClient(aiHubBaseURL, result.accessToken)
        savedApiKey = undefined
        savedApiKeyApplicationId = undefined
        savedModelProvider = undefined
        savedModelGatewayBaseURL = undefined
        failedAttempts = 0
        return await resolveHubKey()
      } finally {
        authInFlight = false
      }
    })
    ipcMain.handle(HUB_KEY_CHANNEL, async (event, request: unknown): Promise<GateResponse> => {
      if (event.sender !== loginWindow.webContents || !gatewayAuthenticated || authenticatedWorkcode === undefined) {
        return { ok: false, code: 'INVALID_AUTH_CONTEXT', message: '请先完成企业账号登录。' }
      }
      if (keyInFlight) return { ok: false, code: 'KEY_CHECK_IN_PROGRESS', message: '正在验证，请稍候。' }
      const payload = request !== null && typeof request === 'object'
        ? request as { action?: unknown; language?: unknown }
        : {}
      const languageError = await adoptLanguage(payload.language)
      if (languageError !== undefined) return languageError
      keyInFlight = true
      try {
        if (payload.action === 'apply') {
          if (aiHubClient === undefined) {
            return { ok: false, code: 'INVALID_AUTH_CONTEXT', message: 'AI Hub 登录上下文无效。' }
          }
          const application = await aiHubClient.applyForKey([requestedModel])
          await recordDesktopEvent(userData, `已向 AI Hub 提交 API Key 申请，模型 ${requestedModel}`)
          if (application.status !== 'PENDING') return await resolveHubKey(true)
          return { ok: true, nextStep: 'hub-key', code: 'KEY_APPLICATION_PENDING', message: 'API Key 申请已提交，等待管理员审批。' }
        }
        return await resolveHubKey(true)
      } catch (error) {
        const hubError = error instanceof AiHubError ? error : undefined
        return {
          ok: false,
          code: hubError?.code ?? 'AI_HUB_UNAVAILABLE',
          message: hubError?.message ?? 'AI Hub 暂不可用，请稍后重试。',
        }
      } finally {
        keyInFlight = false
      }
    })
    ipcMain.handle(RETRY_SAVED_KEY_CHANNEL, async (event, request: unknown): Promise<GateResponse> => {
      if (event.sender !== loginWindow.webContents || !gatewayAuthenticated || authenticatedWorkcode === undefined) {
        return { ok: false, code: 'INVALID_AUTH_CONTEXT', message: '请先完成企业账号登录。' }
      }
      const payload = request !== null && typeof request === 'object'
        ? request as { language?: unknown }
        : {}
      const languageError = await adoptLanguage(payload.language)
      if (languageError !== undefined) return languageError
      return await resolveHubKey()
    })
    loginWindow.once('closed', () => {
      removeHandlers()
      if (!completed) rejectGate(new LoginCancelledError('用户关闭了登录窗口'))
    })
  })
}

function desktopLogPath(userData: string): string {
  return join(userData, 'desktop.log')
}

async function recordDesktopEvent(userData: string, message: string): Promise<void> {
  try {
    await appendDesktopDiagnosticEvent(userData, message)
  } catch {
    // Diagnostics must never become another launch failure.
  }
}

async function showLaunchError(error: unknown, userData: string, language: DesktopLanguage): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await dialog.showMessageBox({
    type: 'error',
    title: language === 'en' ? 'DSH Enterprise Intelligent Workspace could not start' : 'Harness Enterprise Desktop无法启动',
    message: language === 'en' ? 'The app could not start. Contact IT.' : '应用启动失败，请联系 IT 管理员。',
    detail: language === 'en'
      ? `${message}\n\nDiagnostic log: ${desktopLogPath(userData)}`
      : `${message}\n\n诊断日志：${desktopLogPath(userData)}`,
    buttons: [language === 'en' ? 'Exit' : '退出'],
    defaultId: 0,
    cancelId: 0,
  })
}

async function loadLaunchEnvironment(): Promise<NodeJS.ProcessEnv> {
  const projectConfig = app.isPackaged ? undefined : resolve(app.getAppPath(), '..', '..', '.env')
  const project = projectConfig === undefined ? {} : await readEnvironmentFile(projectConfig)
  return mergeEnvironment(process.env, project)
}

async function resolveWorkspace(config: DesktopConfig): Promise<string> {
  const workspace = resolve(config.workspace ?? app.getPath('documents'))
  const info = await stat(workspace).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) throw new Error(`工作目录不存在或不是目录: ${workspace}`)
  return workspace
}

function cliEntry(): string {
  return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
}

function patchPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'config', 'desktop.patch.yml')
    : resolve(app.getAppPath(), 'config', 'desktop.patch.yml')
}

function childEnvironment(
  base: NodeJS.ProcessEnv,
  config: DesktopConfig,
  userData: string,
  model: string,
  broker: WorkBuddyTokenBroker,
  language: DesktopLanguage,
  aiHubBaseURL: string,
  managedSkillDir: string,
  managedInstructionFile: string | undefined,
  managedInstructionHashFile: string | undefined,
  workBuddyEnabled: boolean,
  aiHubCatalog: HubCatalogSnapshot,
  installationId: string,
  localWebAccessToken: string,
  weComCliPath: string | undefined,
): NodeJS.ProcessEnv {
  const executablePath = weComCliPath === undefined
    ? base.PATH
    : [dirname(weComCliPath), base.PATH].filter((value): value is string => value !== undefined && value.length > 0).join(delimiter)
  return {
    ...base,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: join(userData, 'harness-home'),
    DSH_DESKTOP: '1',
    DSH_MANAGED_PROFILE: '1',
    DSH_PERMISSION_MODE: 'workspace-write',
    DSH_WEB_SEARCH_DISABLED: '1',
    DSH_OUTPUT_LANGUAGE_FROM_LOCALE: '1',
    DSH_DESKTOP_LANGUAGE: language,
    // Hub owns this complete model route. Legacy aliases remain temporarily so
    // previously approved managed plug-ins continue to work during migration.
    MODEL_GATEWAY_BASE_URL: config.modelGatewayBaseURL,
    MODEL_GATEWAY_API_KEY: config.modelApiKey,
    MODEL_GATEWAY_DEFAULT_MODEL: model,
    LITELLM_BASE_URL: config.modelGatewayBaseURL,
    LITELLM_API_KEY: config.modelApiKey,
    LITELLM_DEFAULT_MODEL: model,
    DSH_DESKTOP_MCP_URL: config.mcp.url,
    DSH_DESKTOP_MCP_NAME: config.mcp.serverName,
    DSH_DESKTOP_MCP_BROKER_URL: broker.url,
    DSH_DESKTOP_MCP_BROKER_SECRET: broker.secret,
    DSH_AI_HUB_BASE_URL: aiHubBaseURL,
    DSH_HUB_SKILL_DIR: managedSkillDir,
    DSH_MANAGED_HOT_PATCH: join(userData, 'harness-home', 'hub-plugins.patch.yml'),
    DSH_MANAGED_HOT_STATUS: join(userData, 'harness-home', 'hub-plugins.hmr-status.json'),
    // Always overwrite the inherited environment so a user cannot point the
    // managed instruction loader at a local file.
    DSH_HUB_AGENTS_FILE: managedInstructionFile ?? '',
    DSH_HUB_AGENTS_SHA256_FILE: managedInstructionHashFile ?? '',
    DSH_DESKTOP_WORKBUDDY_ENABLED: String(workBuddyEnabled),
    DSH_AI_HUB_CATALOG: JSON.stringify(aiHubCatalog),
    DSH_CLIENT_INSTALLATION_ID: installationId,
    ...(executablePath === undefined ? {} : { PATH: executablePath }),
    [DESKTOP_WEB_ACCESS_TOKEN_ENV]: localWebAccessToken,
  }
}

async function getOrCreateInstallationId(userData: string): Promise<string> {
  const path = join(userData, 'installation-id')
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(existing)) return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const id = randomUUID()
  await mkdir(userData, { recursive: true, mode: 0o700 })
  await writeFile(path, `${id}\n`, { encoding: 'utf8', mode: 0o600 })
  return id
}

async function currentBrokerToken(broker: WorkBuddyTokenBroker): Promise<string> {
  const response = await fetch(broker.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker.secret}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('无法刷新 AI Hub 登录令牌')
  const body = await response.json() as { accessToken?: unknown }
  if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
    throw new Error('AI Hub 登录令牌无效')
  }
  return body.accessToken
}

function managedUpdateTypeLabel(type: ManagedUpdateType, language: DesktopLanguage): string {
  const english = language === 'en'
  switch (type) {
    case 'HARNESS': return english ? 'Application' : '客户端'
    case 'CLIENT_PLUGIN': return english ? 'Plugin' : '插件'
    case 'MCP': return 'MCP'
    case 'TOOL': return 'Tool'
    case 'SKILL': return 'Skill'
    case 'BUNDLE': return 'Bundle'
  }
}

function managedUpdateDetail(update: ManagedUpdateItem, language: DesktopLanguage): string {
  const label = managedUpdateTypeLabel(update.type, language)
  const english = language === 'en'
  let summary: string
  switch (update.action) {
    case 'GRANTED':
      summary = english
        ? `${label} · ${update.name}: newly authorized ${update.toVersion}`
        : `${label} · ${update.name}：新授权 ${update.toVersion}`
      break
    case 'REVOKED':
      summary = english
        ? `${label} · ${update.name}: authorization removed`
        : `${label} · ${update.name}：授权已撤销`
      break
    default:
      summary = `${label} · ${update.name}: ${update.fromVersion} -> ${update.toVersion}`
  }
  return update.notes === undefined ? summary : `${summary}\n${update.notes}`
}

function desktopReleaseNotes(
  value: string | null | Array<{ version: string; note: string | null }> | undefined,
): string | undefined {
  const notes = typeof value === 'string'
    ? value
    : value?.map(item => item.note ?? '').filter(Boolean).join('\n\n')
  return notes === undefined || notes.length === 0 ? undefined : notes.slice(0, 4_000)
}

function trayHubStatusLabel(language: DesktopLanguage): string {
  const english = language === 'en'
  switch (desktopHubStatus) {
    case 'connecting': return english ? 'Hub: connecting' : 'Hub：正在连接'
    case 'syncing': return english ? 'Hub: syncing' : 'Hub：正在同步'
    case 'synced': return english ? 'Hub: synced' : 'Hub：已同步'
    case 'failed': return english ? 'Hub: sync failed' : 'Hub：同步异常'
  }
}

async function exportDiagnosticBundleFromUi(): Promise<void> {
  const context = desktopTrayContext
  if (context === undefined || context.mainWindow.isDestroyed()) return
  const english = context.language === 'en'
  const result = await dialog.showSaveDialog(context.mainWindow, {
    title: english ? 'Export diagnostics' : '导出诊断包',
    defaultPath: join(app.getPath('downloads'),
      `DSH-Harness-Diagnostics-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.zip`),
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (result.canceled) return
  await exportDesktopDiagnostics(context.userData, result.filePath, {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    hubStatus: desktopHubStatus,
    updateStatus: managedUpdateState.status,
  })
  await recordDesktopEvent(context.userData, '用户已导出脱敏诊断包')
}

function refreshDesktopTray(): void {
  const context = desktopTrayContext
  if (desktopTray === undefined || context === undefined) return
  const english = context.language === 'en'
  const updateCount = managedUpdateState.updates.length
  const items: MenuItemConstructorOptions[] = [
    {
      label: english ? 'Open workspace' : '打开工作台',
      click: () => {
        context.mainWindow.show()
        context.mainWindow.focus()
      },
    },
    { label: trayHubStatusLabel(context.language), enabled: false },
    {
      label: updateCount > 0
        ? english ? `Updates available (${String(updateCount)})` : `可用升级（${String(updateCount)}）`
        : english ? 'No updates available' : '暂无可用升级',
      enabled: updateCount > 0,
      click: () => { void openManagedUpdatePrompt() },
    },
    { type: 'separator' },
    {
      label: english ? 'Export diagnostics...' : '导出诊断包...',
      click: () => { void exportDiagnosticBundleFromUi() },
    },
    { type: 'separator' },
    {
      label: english ? 'Quit' : '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]
  desktopTray.setContextMenu(Menu.buildFromTemplate(items))
  desktopTray.setToolTip('Harness Enterprise Desktop')
}

function setDesktopHubStatus(status: typeof desktopHubStatus): void {
  desktopHubStatus = status
  refreshDesktopTray()
}

function installDesktopTray(mainWindow: BrowserWindow, userData: string, language: DesktopLanguage): void {
  desktopTray?.destroy()
  desktopTrayContext = { mainWindow, userData, language }
  desktopTray = new Tray(applicationIconPath())
  desktopTray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.focus()
    else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  refreshDesktopTray()
}

function computeManagedUpdateState(): ManagedUpdateState {
  const offers = [...managedUpdateOffers.values()]
  const status: ManagedUpdateStatus = managedUpdateApplying
    ? 'downloading'
    : offers.some(offer => offer.status === 'failed')
      ? 'failed'
      : offers.some(offer => offer.status === 'available')
        ? 'available'
        : offers.some(offer => offer.status === 'scheduled')
          ? 'scheduled'
          : 'none'
  return { status, updates: offers.flatMap(offer => offer.updates) }
}

function publishManagedUpdateState(): void {
  managedUpdateState = computeManagedUpdateState()
  refreshDesktopTray()
  const window = managedUpdateContext?.mainWindow
  if (window !== undefined && !window.isDestroyed()) {
    window.webContents.send(MANAGED_UPDATE_CHANGED_CHANNEL, managedUpdateState)
  }
}

function registerManagedUpdateOffer(offer: ManagedUpdateOffer): boolean {
  const existing = managedUpdateOffers.get(offer.id)
  managedUpdateOffers.set(offer.id, existing === undefined ? offer : { ...offer, status: existing.status })
  publishManagedUpdateState()
  return existing === undefined
}

function removeManagedUpdateOffer(id: string): void {
  if (!managedUpdateOffers.delete(id)) return
  publishManagedUpdateState()
}

async function applyManagedUpdatesNow(offerIds?: readonly string[]): Promise<void> {
  if (managedUpdateApplying) return
  const offers = (offerIds === undefined
    ? [...managedUpdateOffers.values()]
    : offerIds.flatMap((id) => {
      const offer = managedUpdateOffers.get(id)
      return offer === undefined ? [] : [offer]
    }))
    .sort((left, right) => Number(left.updates.some(item => item.type === 'HARNESS'))
      - Number(right.updates.some(item => item.type === 'HARNESS')))
  if (offers.length === 0) return

  managedUpdateApplying = true
  publishManagedUpdateState()
  try {
    const activations: ManagedUpdateActivation[] = []
    for (const offer of offers) activations.push(await offer.installNow())
    for (const activation of activations) {
      if (!activation.handlesRestart) await activation.activate?.()
    }
    for (const activation of activations) await activation.commit?.()
    for (const activation of activations) {
      if (activation.handlesRestart) await activation.activate?.()
    }
    for (const offer of offers) managedUpdateOffers.delete(offer.id)
    managedUpdateApplying = false
    publishManagedUpdateState()
    const restart = activations.some(activation => activation.restart)
    const handled = activations.some(activation => activation.handlesRestart)
    if (restart && !handled) {
      app.relaunch()
      app.quit()
    }
  } catch (error) {
    managedUpdateApplying = false
    for (const offer of offers) {
      managedUpdateOffers.set(offer.id, { ...offer, status: 'failed' })
    }
    publishManagedUpdateState()
    const context = managedUpdateContext
    const detail = error instanceof Error ? error.message : String(error)
    if (context !== undefined) {
      await recordDesktopEvent(context.userData, `统一升级执行失败: ${detail}`)
      if (!context.mainWindow.isDestroyed()) {
        const english = context.language === 'en'
        await dialog.showMessageBox(context.mainWindow, {
          type: 'error',
          title: english ? 'Update failed' : '升级失败',
          message: english
            ? 'The update was not installed. The current versions remain available.'
            : '升级未完成，当前版本仍可继续使用。',
          detail,
          buttons: [english ? 'OK' : '确定'],
        })
      }
    }
  }
}

async function openManagedUpdatePrompt(): Promise<void> {
  const context = managedUpdateContext
  if (context === undefined || managedUpdatePromptOpen || managedUpdateApplying
    || context.mainWindow.isDestroyed() || managedUpdateOffers.size === 0) return
  const english = context.language === 'en'
  const offers = [...managedUpdateOffers.values()]
  const detail = offers.flatMap(offer => offer.updates.map(update =>
    managedUpdateDetail(update, context.language))).join('\n').slice(0, 12_000)
  managedUpdatePromptOpen = true
  const result = await dialog.showMessageBox(context.mainWindow, {
    type: 'info',
    title: english ? 'Updates available' : '有可用升级',
    message: english
      ? 'Choose when DSH Enterprise Intelligent Workspace should apply all available updates.'
      : '选择何时应用 Harness Enterprise Desktop 的全部可用升级。',
    detail,
    buttons: english
      ? ['Cancel', 'Update silently on next launch', 'Download and restart now']
      : ['取消', '下次启动时静默升级', '立即下载并重启'],
    defaultId: 2,
    cancelId: 0,
  }).finally(() => { managedUpdatePromptOpen = false })
  if (result.response === 1) {
    try {
      for (const offer of offers) await offer.schedule()
      for (const offer of offers) managedUpdateOffers.set(offer.id, { ...offer, status: 'scheduled' })
      publishManagedUpdateState()
      await recordDesktopEvent(context.userData, `升级已安排在下次启动：${detail.replaceAll('\n', '；')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const offer of offers) managedUpdateOffers.set(offer.id, { ...offer, status: 'failed' })
      publishManagedUpdateState()
      await recordDesktopEvent(context.userData, `安排下次启动升级失败: ${message}`)
    }
    return
  }
  if (result.response === 2) await applyManagedUpdatesNow(offers.map(offer => offer.id))
}

interface DesktopUpdateSchedule {
  platform: HubDesktopReleasePlatform
  version: string
}

function desktopUpdateSchedulePath(userData: string): string {
  return join(userData, 'desktop-update-schedule.json')
}

async function readDesktopUpdateSchedule(userData: string): Promise<DesktopUpdateSchedule | undefined> {
  try {
    const parsed = JSON.parse(await readFile(desktopUpdateSchedulePath(userData), 'utf8')) as Partial<DesktopUpdateSchedule>
    if ((parsed.platform === 'MAC_ARM64' || parsed.platform === 'MAC_X64' || parsed.platform === 'WINDOWS_X64')
      && typeof parsed.version === 'string' && parsed.version.length > 0) {
      return { platform: parsed.platform, version: parsed.version }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await recordDesktopEvent(userData,
        `读取客户端升级计划失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return undefined
}

async function writeDesktopUpdateSchedule(userData: string, schedule: DesktopUpdateSchedule): Promise<void> {
  const target = desktopUpdateSchedulePath(userData)
  const stage = `${target}.tmp`
  await mkdir(userData, { recursive: true })
  await writeFile(stage, `${JSON.stringify(schedule)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(stage, target)
}

async function clearDesktopUpdateSchedule(userData: string): Promise<void> {
  await rm(desktopUpdateSchedulePath(userData), { force: true })
}

function scheduleDesktopUpdateChecks(mainWindow: BrowserWindow, check: () => Promise<void>): void {
  let lastStartedAt = 0
  const run = (): void => {
    lastStartedAt = Date.now()
    void check()
  }
  const onFocus = (): void => {
    if (Date.now() - lastStartedAt >= DESKTOP_UPDATE_FOCUS_THROTTLE_MS) run()
  }
  desktopUpdateInitialTimer = setTimeout(run, DESKTOP_UPDATE_INITIAL_DELAY_MS)
  desktopUpdateInitialTimer.unref()
  desktopUpdateTimer = setInterval(run, DESKTOP_UPDATE_INTERVAL_MS)
  desktopUpdateTimer.unref()
  mainWindow.on('focus', onFocus)
  mainWindow.once('closed', () => { mainWindow.off('focus', onFocus) })
}

function startDesktopUpdateChecks(options: {
  mainWindow: BrowserWindow
  broker: WorkBuddyTokenBroker
  aiHubBaseURL: string
  userData: string
  language: DesktopLanguage
}): void {
  if (!app.isPackaged) return
  const platform = desktopReleasePlatform()
  if (platform === undefined) return
  if (platform === 'WINDOWS_X64') {
    startWindowsDesktopUpdateChecks(options)
    return
  }
  let running = false
  let activeOfferId: string | undefined

  const check = async (): Promise<void> => {
    if (running || quitting || options.mainWindow.isDestroyed()) return
    running = true
    try {
      const token = await currentBrokerToken(options.broker)
      const client = new AiHubClient(options.aiHubBaseURL, token)
      const release = await client.latestDesktopRelease(platform, app.getVersion())
      if (release === undefined || options.mainWindow.isDestroyed()) {
        if (activeOfferId !== undefined) removeManagedUpdateOffer(activeOfferId)
        activeOfferId = undefined
        await clearDesktopUpdateSchedule(options.userData)
        return
      }
      const offerId = `desktop:${platform}:${release.version}`
      if (activeOfferId !== undefined && activeOfferId !== offerId) removeManagedUpdateOffer(activeOfferId)
      activeOfferId = offerId
      const schedule = await readDesktopUpdateSchedule(options.userData)
      const scheduled = schedule?.platform === platform && schedule.version === release.version
      if (schedule !== undefined && !scheduled) await clearDesktopUpdateSchedule(options.userData)
      const created = registerManagedUpdateOffer({
        id: offerId,
        status: scheduled ? 'scheduled' : 'available',
        updates: [{
          type: 'HARNESS',
          externalRef: 'harness-enterprise-desktop',
          name: 'Harness Enterprise Desktop',
          fromVersion: app.getVersion(),
          toVersion: release.version,
          ...release.releaseNotes.length === 0 ? {} : { notes: release.releaseNotes.slice(0, 4_000) },
        }],
        schedule: async () => { await writeDesktopUpdateSchedule(options.userData, { platform, version: release.version }) },
        installNow: async () => {
          const currentToken = await currentBrokerToken(options.broker)
          const currentClient = new AiHubClient(options.aiHubBaseURL, currentToken)
          if (Notification.isSupported()) {
            new Notification({
              title: options.language === 'en' ? 'Downloading update' : '正在下载升级',
              body: options.language === 'en'
                ? 'The installer will be verified before it is opened.'
                : '安装程序将在打开前完成完整性校验。',
            }).show()
          }
          const installer = await currentClient.downloadDesktopRelease(
            release,
            join(options.userData, 'desktop-updates'),
            (progress) => { if (!options.mainWindow.isDestroyed()) options.mainWindow.setProgressBar(progress) },
          ).finally(() => {
            if (!options.mainWindow.isDestroyed()) options.mainWindow.setProgressBar(-1)
          })
          await recordDesktopEvent(options.userData,
            `客户端下载并校验完成: version=${release.version},sha256=${release.sha256}`)
          return {
            restart: false,
            activate: async () => {
              const openError = await shell.openPath(installer)
              if (openError !== '') throw new Error(openError)
              await clearDesktopUpdateSchedule(options.userData)
            },
          }
        },
      })
      if (scheduled) {
        await applyManagedUpdatesNow([offerId])
      } else if (created && Notification.isSupported()) {
        new Notification({
          title: options.language === 'en' ? 'Application update available' : '客户端有可用升级',
          body: options.language === 'en'
            ? 'Open the update icon to install now or schedule the next launch.'
            : '点击侧边栏更新图标，可立即升级或安排到下次启动。',
        }).show()
      }
    } catch (error) {
      await recordDesktopEvent(options.userData,
        `客户端版本检查失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
    }
  }

  scheduleDesktopUpdateChecks(options.mainWindow, check)
}

function windowsUpdateFeedURL(aiHubBaseURL: string): string {
  return `${aiHubBaseURL.replace(/\/+$/, '')}/api/client/desktop-updates/windows`
}

function startWindowsDesktopUpdateChecks(options: {
  mainWindow: BrowserWindow
  broker: WorkBuddyTokenBroker
  aiHubBaseURL: string
  userData: string
  language: DesktopLanguage
}): void {
  let running = false
  let updaterPromise: Promise<NsisUpdater> | undefined
  let activeOfferId: string | undefined

  const getUpdater = (): Promise<NsisUpdater> => {
    updaterPromise ??= import('electron-updater').then(({ NsisUpdater }) => {
      const updater = new NsisUpdater({
        provider: 'generic',
        url: windowsUpdateFeedURL(options.aiHubBaseURL),
        channel: 'latest',
        useMultipleRangeRequest: false,
      })
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.allowPrerelease = true
      updater.allowDowngrade = false
      // AI Hub does not publish blockmaps yet. Avoid a failed range probe and
      // use one authenticated, SHA-512-verified installer download.
      updater.disableDifferentialDownload = true
      updater.on('download-progress', (progress) => {
        if (!options.mainWindow.isDestroyed()) options.mainWindow.setProgressBar(progress.percent / 100)
      })
      updater.on('error', (error) => {
        void recordDesktopEvent(options.userData, `Windows 客户端升级失败: ${error.message}`)
      })
      return updater
    })
    return updaterPromise
  }

  const check = async (): Promise<void> => {
    if (running || quitting || options.mainWindow.isDestroyed()) return
    running = true
    try {
      const updater = await getUpdater()
      const token = await currentBrokerToken(options.broker)
      updater.requestHeaders = { Authorization: `Bearer ${token}` }
      const result = await updater.checkForUpdates()
      await recordDesktopEvent(options.userData, result === null
        ? `Windows 客户端版本检查完成: current=${app.getVersion()},result=empty`
        : `Windows 客户端版本检查完成: current=${app.getVersion()},latest=${result.updateInfo.version},available=${result.isUpdateAvailable}`)
      if (result === null || !result.isUpdateAvailable || options.mainWindow.isDestroyed()) {
        if (activeOfferId !== undefined) removeManagedUpdateOffer(activeOfferId)
        activeOfferId = undefined
        await clearDesktopUpdateSchedule(options.userData)
        return
      }
      const version = result.updateInfo.version
      const platform = 'WINDOWS_X64' as const
      const offerId = `desktop:${platform}:${version}`
      if (activeOfferId !== undefined && activeOfferId !== offerId) removeManagedUpdateOffer(activeOfferId)
      activeOfferId = offerId
      const schedule = await readDesktopUpdateSchedule(options.userData)
      const scheduled = schedule?.platform === platform && schedule.version === version
      if (schedule !== undefined && !scheduled) await clearDesktopUpdateSchedule(options.userData)
      const notes = desktopReleaseNotes(result.updateInfo.releaseNotes)
      const created = registerManagedUpdateOffer({
        id: offerId,
        status: scheduled ? 'scheduled' : 'available',
        updates: [{
          type: 'HARNESS',
          externalRef: 'harness-enterprise-desktop',
          name: 'Harness Enterprise Desktop',
          fromVersion: app.getVersion(),
          toVersion: version,
          ...(notes === undefined ? {} : { notes }),
        }],
        schedule: async () => { await writeDesktopUpdateSchedule(options.userData, { platform, version }) },
        installNow: async () => {
          const currentToken = await currentBrokerToken(options.broker)
          updater.requestHeaders = { Authorization: `Bearer ${currentToken}` }
          try {
            await updater.downloadUpdate()
          } finally {
            if (!options.mainWindow.isDestroyed()) options.mainWindow.setProgressBar(-1)
          }
          await recordDesktopEvent(options.userData, `Windows 客户端更新已下载并校验: version=${version}`)
          return {
            restart: true,
            handlesRestart: true,
            activate: async () => {
              await clearDesktopUpdateSchedule(options.userData)
              await recordDesktopEvent(options.userData, `开始静默覆盖安装 Windows 客户端: version=${version}`)
              updater.quitAndInstall(true, true)
            },
          }
        },
      })
      if (scheduled) {
        await applyManagedUpdatesNow([offerId])
      } else if (created && Notification.isSupported()) {
        new Notification({
          title: options.language === 'en' ? 'Application update available' : '客户端有可用升级',
          body: options.language === 'en'
            ? 'Open the update icon to install now or schedule the next launch.'
            : '点击侧边栏更新图标，可立即升级或安排到下次启动。',
        }).show()
      }
    } catch (error) {
      await recordDesktopEvent(options.userData,
        `Windows 客户端版本检查失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
    }
  }

  scheduleDesktopUpdateChecks(options.mainWindow, check)
}

function startCapabilitySync(options: {
  broker: WorkBuddyTokenBroker
  aiHubBaseURL: string
  managedSkillDir: string
  managedPluginDir: string
  managedPluginPatch: string
  managedInstructionDir: string
  initial: HubCatalogSyncResult
  userData: string
  recovery: ManagedCapabilityRecovery
}): void {
  let revisions = catalogRevisions(options.initial.snapshot)
  let activeCatalog: HubCatalog | HubCatalogSnapshot = options.initial.snapshot
  let activeResult = options.initial
  let running = false

  capabilitySyncTimer = setInterval(() => {
    if (running || quitting || managedUpdateApplying) return
    running = true
    setDesktopHubStatus('syncing')
    void currentBrokerToken(options.broker)
      .then(async (token) => {
        const client = new AiHubClient(options.aiHubBaseURL, token)
        const latest = await client.catalog()
        const latestRevisions = catalogRevisions(latest)
        const activationChanged = latestRevisions.activation !== revisions.activation
        const gatewayChanged = latestRevisions.gateway !== revisions.gateway
        const skillsChanged = latestRevisions.skills !== revisions.skills
        const instructionsChanged = latestRevisions.instructions !== revisions.instructions
        if (!activationChanged && !gatewayChanged && !skillsChanged && !instructionsChanged) {
          return undefined
        }
        if (activationChanged) {
          const updates = catalogActivationChanges(activeCatalog, latest)
          await options.recovery.stageUpdate()
          try {
            const next = await client.synchronizeCatalog(
              options.managedSkillDir,
              options.managedPluginDir,
              options.managedPluginPatch,
              options.managedInstructionDir,
              latest,
            )
            const revision = next.pluginPatchRevision
            if (revision === undefined) throw new Error('受管插件 Patch 缺少热更新版本')
            await waitForManagedPluginHotReload(
              join(dirname(options.managedPluginPatch), 'hub-plugins.hmr-status.json'),
              revision,
            )
            await options.recovery.writeActiveResult(next)
            await options.recovery.clearActivationSchedule()
            await options.recovery.markHealthy()
            await recordDesktopEvent(options.userData,
              `企业插件已热更新：${updates.map(update => `${update.action}:${update.externalRef} ${update.fromVersion}->${update.toVersion}`).join('；')}`)
            return { next, gatewayChanged, skillsChanged, instructionsChanged, pluginsChanged: true }
          } catch (error) {
            const restored = await options.recovery.rollback()
            const restoredRevision = restored?.pluginPatchRevision
            if (restoredRevision !== undefined) {
              await waitForManagedPluginHotReload(
                join(dirname(options.managedPluginPatch), 'hub-plugins.hmr-status.json'),
                restoredRevision,
              ).catch(async (rollbackError: unknown) => {
                await recordDesktopEvent(options.userData,
                  `企业插件热更新回退确认失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
              })
            }
            await options.recovery.scheduleActivation(latestRevisions.activation)
            throw error
          }
        }
        if (!skillsChanged && !instructionsChanged) {
          const next: HubCatalogSyncResult = {
            ...activeResult,
            workBuddyEnabled: latest.mcps.some(item => item.tools.length > 0),
            snapshot: catalogSnapshot(latest),
          }
          await options.recovery.writeActiveResult(next)
          return { next, gatewayChanged, skillsChanged, instructionsChanged, pluginsChanged: false }
        }
        const next = await client.synchronizeCatalog(
          options.managedSkillDir,
          options.managedPluginDir,
          options.managedPluginPatch,
          options.managedInstructionDir,
          latest,
          { preserveSkillRoot: true, preservePluginRoot: true },
        )
        await options.recovery.writeActiveResult(next)
        return { next, gatewayChanged, skillsChanged, instructionsChanged, pluginsChanged: false }
      })
      .then(async (update) => {
        if (update === undefined) return
        const { next, gatewayChanged, skillsChanged, instructionsChanged, pluginsChanged } = update
        revisions = catalogRevisions(next.snapshot)
        activeCatalog = next.snapshot
        activeResult = next
        await recordDesktopEvent(options.userData,
          `AI Hub 能力已对账：${next.skillCount} 个 Skill，${next.pluginCount} 个客户端插件，${next.instructionCount} 份企业指令`)
        if (pluginsChanged || gatewayChanged || skillsChanged || instructionsChanged) {
          await recordDesktopEvent(options.userData, '企业能力已在后台生效，无需重启客户端')
        }
      })
      .catch((error: unknown) => recordDesktopEvent(options.userData,
        `AI Hub 后台对账失败: ${error instanceof Error ? error.message : String(error)}`)
        .then(() => { setDesktopHubStatus('failed') }))
      .finally(() => {
        if (desktopHubStatus !== 'failed') setDesktopHubStatus('synced')
        running = false
      })
  }, CAPABILITY_SYNC_INTERVAL_MS)
  capabilitySyncTimer.unref()
}

interface RendererBootHealth {
  ok: boolean
  entries: string[]
  error?: string
}

function waitForRendererBootHealth(mainWindow: BrowserWindow, timeoutMs = 60_000): Promise<RendererBootHealth> {
  return new Promise((resolveHealth, rejectHealth) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      ipcMain.off(BOOT_HEALTH_CHANNEL, receive)
      mainWindow.off('closed', cleanup)
    }
    const receive = (event: IpcMainEvent, payload: unknown): void => {
      if (event.sender !== mainWindow.webContents || typeof payload !== 'object' || payload === null) return
      const candidate = payload as { ok?: unknown; entries?: unknown; error?: unknown }
      if (typeof candidate.ok !== 'boolean') return
      cleanup()
      resolveHealth({
        ok: candidate.ok,
        entries: Array.isArray(candidate.entries)
          ? candidate.entries.filter((value): value is string => typeof value === 'string').slice(0, 256)
          : [],
        ...(typeof candidate.error === 'string' ? { error: candidate.error.slice(0, 8_000) } : {}),
      })
    }
    const timer = setTimeout(() => {
      cleanup()
      rejectHealth(new Error('客户端插件健康检查超时'))
    }, timeoutMs)
    ipcMain.on(BOOT_HEALTH_CHANNEL, receive)
    mainWindow.once('closed', cleanup)
  })
}

async function startBackend(cwd: string, env: NodeJS.ProcessEnv, userData: string, managedPluginPatch: string): Promise<string> {
  await mkdir(userData, { recursive: true })
  const log = createWriteStream(desktopLogPath(userData), { flags: 'a', mode: 0o600 })
  const child = spawn(process.execPath, [
    '--expose-internals',
    cliEntry(),
    'web',
    '--patch', patchPath(),
    '--patch', managedPluginPatch,
    '--host', '127.0.0.1',
    '--port', '0',
  ], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  backend = child
  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    let pending = ''
    const finish = (error?: Error, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error !== undefined) rejectReady(error)
      else if (url === undefined) rejectReady(new Error('Harness Enterprise Desktop后端没有返回访问地址'))
      else resolveReady(url)
    }
    const timer = setTimeout(() => {
      finish(new Error('Harness Enterprise Desktop后端启动超时'))
    }, 60_000)
    const consume = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      log.write(text)
      pending = `${pending}${text}`.slice(-16_384)
      const match = READY_PATTERN.exec(pending)
      if (match?.[1] !== undefined) finish(undefined, match[1])
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', (chunk) => {
      log.write(chunk)
    })
    child.once('error', (error) => {
      finish(new Error('无法启动 Harness Enterprise Desktop后端', { cause: error }))
    })
    child.once('exit', (code, signal) => {
      log.end()
      backend = undefined
      if (!settled) finish(new Error(`Harness Enterprise Desktop后端提前退出 (${code ?? signal ?? 'unknown'})`))
      else if (!quitting && !expectedBackendExits.has(child)) {
        void activeBootMarker?.update(app.getVersion(), 'backend-exit')
        void dialog.showMessageBox({
          type: 'error',
          title: 'Harness Enterprise Desktop已停止',
          message: `后端进程已退出 (${code ?? signal ?? 'unknown'})`,
          detail: join(userData, 'desktop.log'),
        }).then(() => {
          app.quit()
        })
      }
    })
  })
}

function stopBackend(): void {
  const child = backend
  if (child === undefined || child.killed) return
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 5_000).unref()
}

async function stopBackendForRecovery(): Promise<void> {
  const child = backend
  if (child === undefined || child.exitCode !== null) return
  expectedBackendExits.add(child)
  const exited = new Promise<void>(resolveExit => child.once('exit', () => { resolveExit() }))
  child.kill('SIGTERM')
  const killTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 5_000)
  killTimer.unref()
  await exited
  clearTimeout(killTimer)
}

function configureStableUserDataPath(): void {
  if (!app.isPackaged) return
  app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness'))
}

function registerDesktopPreviewHandlers(mainWindow: BrowserWindow): void {
  const assertSender = (senderId: number): void => {
    if (senderId !== mainWindow.webContents.id) throw new Error('desktop preview rejected an unknown renderer')
  }
  const publicError = (error: unknown): { ok: false; code: string } => ({
    ok: false,
    code: error instanceof DesktopPreviewError ? error.code : 'unavailable',
  })

  ipcMain.removeHandler(PREVIEW_READ_CHANNEL)
  ipcMain.removeHandler(PREVIEW_OPEN_EXTERNAL_CHANNEL)
  ipcMain.handle(PREVIEW_READ_CHANNEL, async (event, request: DesktopPreviewRequest) => {
    assertSender(event.sender.id)
    try {
      return { ok: true, file: await readDesktopPreviewFile(request) }
    } catch (error) {
      return publicError(error)
    }
  })
  ipcMain.handle(PREVIEW_OPEN_EXTERNAL_CHANNEL, async (event, request: DesktopPreviewRequest) => {
    assertSender(event.sender.id)
    try {
      const target = await resolveDesktopPreviewPath(request)
      const message = await shell.openPath(target.path)
      return message === '' ? { ok: true } : { ok: false, code: 'open-failed' }
    } catch (error) {
      return publicError(error)
    }
  })

  mainWindow.once('closed', () => {
    ipcMain.removeHandler(PREVIEW_READ_CHANNEL)
    ipcMain.removeHandler(PREVIEW_OPEN_EXTERNAL_CHANNEL)
  })
}

function registerDesktopAttachmentHandlers(mainWindow: BrowserWindow): void {
  const assertSender = (senderId: number): void => {
    if (senderId !== mainWindow.webContents.id) throw new Error('desktop attachment rejected an unknown renderer')
  }
  const cacheRoot = join(app.getPath('temp'), 'dsh-harness-office-attachments')
  const cacheReady = rm(cacheRoot, { recursive: true, force: true }).catch(() => undefined)

  ipcMain.removeHandler(ATTACHMENT_OPEN_CHANNEL)
  ipcMain.handle(ATTACHMENT_OPEN_CHANNEL, async (event, rawRequest: unknown) => {
    assertSender(event.sender.id)
    try {
      await cacheReady
      const request = parseDesktopAttachmentOpenRequest(rawRequest)
      const path = await materializeDesktopAttachment(request, cacheRoot)
      const message = await shell.openPath(path)
      return message === '' ? { ok: true } : { ok: false, code: 'open-failed' }
    } catch (error) {
      return {
        ok: false,
        code: error instanceof DesktopAttachmentOpenError ? error.code : 'unavailable',
      }
    }
  })

  mainWindow.once('closed', () => {
    ipcMain.removeHandler(ATTACHMENT_OPEN_CHANNEL)
  })
}

function registerPersonalMemoryHandlers(
  mainWindow: BrowserWindow,
  store: PersonalMemoryStore,
  workcode: string,
): void {
  const assertSender = (senderId: number): void => {
    if (senderId !== mainWindow.webContents.id) throw new Error('personal memory rejected an unknown renderer')
  }
  const wrap = async <T>(action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> => {
    try {
      return { ok: true, value: await action() }
    } catch {
      return { ok: false, code: 'PERSONAL_MEMORY_UNAVAILABLE' }
    }
  }
  const requestObject = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const requestString = (request: Record<string, unknown>, field: string): string =>
    typeof request[field] === 'string' ? request[field] : ''
  const bind = (channel: string, handler: (request: Record<string, unknown>) => unknown): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, request: unknown) => {
      assertSender(event.sender.id)
      return handler(requestObject(request))
    })
  }

  bind(PERSONAL_MEMORY_STATE_CHANNEL, () => wrap(() => store.read(workcode)))
  bind(PERSONAL_MEMORY_ENABLE_CHANNEL, request => wrap(() => store.setEnabled(workcode, request.enabled === true)))
  bind(PERSONAL_MEMORY_REMOVE_CHANNEL, request => wrap(() => store.remove(workcode, requestString(request, 'id'))))
  bind(PERSONAL_MEMORY_CLEAR_CHANNEL, () => wrap(() => store.clear(workcode)))

  mainWindow.once('closed', () => {
    for (const channel of [
      PERSONAL_MEMORY_STATE_CHANNEL,
      PERSONAL_MEMORY_ENABLE_CHANNEL,
      PERSONAL_MEMORY_REMOVE_CHANNEL,
      PERSONAL_MEMORY_CLEAR_CHANNEL,
    ]) ipcMain.removeHandler(channel)
  })
}

function registerEnterpriseAccountHandlers(
  mainWindow: BrowserWindow,
  readAccount: () => WorkBuddyAccountSnapshot,
  revokeSession: () => Promise<void>,
  userData: string,
): void {
  const assertSender = (senderId: number): void => {
    if (senderId !== mainWindow.webContents.id) throw new Error('enterprise account rejected an unknown renderer')
  }
  let logoutInFlight = false
  const state = () => {
    const account = readAccount()
    const profile = account.profile
    return {
      workcode: account.workcode,
      providerId: profile.providerId,
      ...profile.displayName === undefined ? {} : { displayName: profile.displayName },
      ...profile.department === undefined ? {} : { department: profile.department },
      departmentCodes: [...profile.departmentCodes],
      ...profile.jobTitle === undefined ? {} : { jobTitle: profile.jobTitle },
      ...profile.email === undefined ? {} : { email: profile.email },
      ...profile.phone === undefined ? {} : { phone: profile.phone },
      sessionExpiresAt: new Date(account.expiresAt).toISOString(),
    }
  }

  ipcMain.removeHandler(ENTERPRISE_ACCOUNT_STATE_CHANNEL)
  ipcMain.removeHandler(ENTERPRISE_ACCOUNT_LOGOUT_CHANNEL)
  ipcMain.handle(ENTERPRISE_ACCOUNT_STATE_CHANNEL, (event) => {
    assertSender(event.sender.id)
    return { ok: true, value: state() }
  })
  ipcMain.handle(ENTERPRISE_ACCOUNT_LOGOUT_CHANNEL, async (event) => {
    assertSender(event.sender.id)
    if (logoutInFlight) return { ok: true }
    logoutInFlight = true
    await recordDesktopEvent(userData, `用户主动退出企业账号，工号 ${readAccount().workcode}`).catch(() => {})
    try {
      await revokeSession()
      await recordDesktopEvent(userData, '企业认证会话已撤销').catch(() => {})
    } catch (error) {
      await recordDesktopEvent(userData,
        `企业认证会话远程撤销失败，将继续清理本地会话: ${error instanceof Error ? error.message : String(error)}`)
        .catch(() => {})
    }
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 80)
    return { ok: true }
  })

  mainWindow.once('closed', () => {
    ipcMain.removeHandler(ENTERPRISE_ACCOUNT_STATE_CHANNEL)
    ipcMain.removeHandler(ENTERPRISE_ACCOUNT_LOGOUT_CHANNEL)
  })
}

function registerManagedUpdateHandlers(
  mainWindow: BrowserWindow,
  userData: string,
  language: DesktopLanguage,
): void {
  const assertSender = (senderId: number): void => {
    if (senderId !== mainWindow.webContents.id) throw new Error('managed update rejected an unknown renderer')
  }
  managedUpdateContext = { mainWindow, userData, language }
  ipcMain.removeHandler(MANAGED_UPDATE_STATE_CHANNEL)
  ipcMain.removeHandler(MANAGED_UPDATE_OPEN_CHANNEL)
  ipcMain.handle(MANAGED_UPDATE_STATE_CHANNEL, (event) => {
    assertSender(event.sender.id)
    return { ok: true, value: managedUpdateState }
  })
  ipcMain.handle(MANAGED_UPDATE_OPEN_CHANNEL, async (event) => {
    assertSender(event.sender.id)
    await openManagedUpdatePrompt()
    return { ok: true, value: managedUpdateState }
  })
  mainWindow.once('closed', () => {
    managedUpdateContext = undefined
    managedUpdateOffers.clear()
    managedUpdateState = { status: 'none', updates: [] }
    ipcMain.removeHandler(MANAGED_UPDATE_STATE_CHANNEL)
    ipcMain.removeHandler(MANAGED_UPDATE_OPEN_CHANNEL)
  })
}

function registerManagedSkillSetupHandlers(
  mainWindow: BrowserWindow,
  manager: WeComSkillAuthManager,
): void {
  const assertSender = (senderId: number): void => {
    if (senderId !== mainWindow.webContents.id) throw new Error('managed Skill setup rejected an unknown renderer')
  }
  const externalRef = (request: unknown): string | undefined => {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) return undefined
    const value = (request as Record<string, unknown>).externalRef
    return typeof value === 'string' ? value : undefined
  }
  const unsubscribe = manager.subscribe((state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(MANAGED_SKILL_SETUP_CHANGED_CHANNEL, state)
  })
  const withSupportedSkill = async <T>(request: unknown, action: (capabilityExternalRef: string) => T | Promise<T>) => {
    const capabilityExternalRef = externalRef(request)
    if (!isWeComCapabilityExternalRef(capabilityExternalRef)) {
      return { ok: false, code: 'UNSUPPORTED_SKILL_SETUP' }
    }
    try {
      return { ok: true, value: await action(capabilityExternalRef) }
    } catch {
      return { ok: false, code: 'SKILL_SETUP_UNAVAILABLE' }
    }
  }

  for (const channel of [
    MANAGED_SKILL_SETUP_STATE_CHANNEL,
    MANAGED_SKILL_SETUP_START_CHANNEL,
    MANAGED_SKILL_SETUP_CANCEL_CHANNEL,
  ]) ipcMain.removeHandler(channel)
  ipcMain.handle(MANAGED_SKILL_SETUP_STATE_CHANNEL, (event, request: unknown) => {
    assertSender(event.sender.id)
    return withSupportedSkill(request, capabilityExternalRef => manager.state(capabilityExternalRef))
  })
  ipcMain.handle(MANAGED_SKILL_SETUP_START_CHANNEL, (event, request: unknown) => {
    assertSender(event.sender.id)
    return withSupportedSkill(request, capabilityExternalRef => manager.start(capabilityExternalRef))
  })
  ipcMain.handle(MANAGED_SKILL_SETUP_CANCEL_CHANNEL, (event, request: unknown) => {
    assertSender(event.sender.id)
    return withSupportedSkill(request, capabilityExternalRef => manager.cancel(capabilityExternalRef))
  })

  mainWindow.once('closed', () => {
    unsubscribe()
    manager.dispose()
    for (const channel of [
      MANAGED_SKILL_SETUP_STATE_CHANNEL,
      MANAGED_SKILL_SETUP_START_CHANNEL,
      MANAGED_SKILL_SETUP_CANCEL_CHANNEL,
    ]) ipcMain.removeHandler(channel)
  })
}

async function start(): Promise<void> {
  const userData = app.getPath('userData')
  let launchLanguage = systemDesktopLanguage(app.getLocale())
  await rotateDesktopLogs(userData).catch(() => {})
  const bootMarker = new DesktopBootMarker(userData)
  activeBootMarker = bootMarker
  const previousBoot = await bootMarker.begin(app.getVersion())
  if (previousBoot !== undefined) {
    await recordDesktopEvent(userData,
      `检测到上一次未完成启动: version=${previousBoot.appVersion},phase=${previousBoot.phase}`)
  }
  const managedCredentialPath = join(userData, 'managed-model-key.bin')
  const migratedCredential = await migrateManagedModelCredential(managedCredentialPath, [
    join(userData, 'managed-litellm-key.bin'),
    join(app.getPath('appData'), '@deepseek-ai', 'dsh-desktop', 'managed-litellm-key.bin'),
    join(app.getPath('appData'), PRODUCT_NAME, 'managed-litellm-key.bin'),
  ])
  if (migratedCredential !== undefined) {
    await recordDesktopEvent(userData, '已迁移旧版客户端保存的 API Key 凭据')
  }
  const credentialStore = new ManagedModelCredentialStore(managedCredentialPath, safeStorage)
  const personalMemoryStore = new PersonalMemoryStore(join(userData, 'personal-memory'), safeStorage)
  await recordDesktopEvent(userData, '应用进程已就绪，等待用户登录')
  if (process.platform === 'win32') {
    const findings = await inspectWindowsStorage([
      process.execPath,
      userData,
      join(userData, 'harness-home', 'profiles', 'hub-plugins'),
    ])
    const unsupported = findings.filter(item => !item.supported)
    if (unsupported.length > 0) {
      const detail = unsupported
        .map(item => `${item.volume} (${item.fileSystem}) - ${item.path}`)
        .join('\n')
      await recordDesktopEvent(userData, `Windows 存储环境不受支持: ${detail.replaceAll('\n', '；')}`)
      const decision = await dialog.showMessageBox({
        type: 'warning',
        title: '存储环境风险',
        message: '安装目录或用户数据目录不在 NTFS/ReFS 文件系统上。',
        detail: `${detail}\n\n网络盘、移动盘或 FAT/exFAT 可能导致插件权限、覆盖安装和版本回退失败。`,
        buttons: ['退出', '仍然继续'],
        defaultId: 0,
        cancelId: 0,
      })
      if (decision.response === 0) {
        await bootMarker.markHealthy()
        app.quit()
        return
      }
    }
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  let launchEnvironment: NodeJS.ProcessEnv
  let oauthClient: WorkBuddyOAuthClient
  let gate: LaunchGateResult
  let aiHubBaseURL = ''
  try {
    launchEnvironment = await loadLaunchEnvironment()
    aiHubBaseURL = launchEnvironment.AI_HUB_BASE_URL?.trim() || MANAGED_AI_HUB_BASE_URL
    const issuer = launchEnvironment.WORKBUDDY_ISSUER?.trim()
    const mcpURL = launchEnvironment.WORKBUDDY_MCP_URL?.trim()
    const redirectURI = launchEnvironment.WORKBUDDY_REDIRECT_URI?.trim()
    oauthClient = new WorkBuddyOAuthClient({
      ...(issuer === undefined || issuer === '' ? {} : { issuer }),
      ...(mcpURL === undefined || mcpURL === '' ? {} : { mcpURL }),
      ...(redirectURI === undefined || redirectURI === '' ? {} : { redirectURI }),
    })
    const requestedModel = launchEnvironment.MODEL_GATEWAY_DEFAULT_MODEL?.trim()
      || launchEnvironment.LITELLM_DEFAULT_MODEL?.trim()
      || 'deepseek-v4-flash'
    gate = await waitForLaunchGate(oauthClient, credentialStore, userData, aiHubBaseURL, requestedModel)
    launchLanguage = gate.language
  } catch (error) {
    if (error instanceof LoginCancelledError) {
      await bootMarker.markHealthy()
      app.quit()
      return
    }
    await recordDesktopEvent(userData, `登录阶段失败: ${error instanceof Error ? error.message : String(error)}`)
    await showLaunchError(error, userData, launchLanguage)
    app.quit()
    return
  }

  try {
    await bootMarker.update(app.getVersion(), 'authenticated')
    const weComCliPath = await resolveWeComCliPath()
    const weComAuthManager = new WeComSkillAuthManager(
      weComCliPath,
      userData,
      gate.workBuddySession.workcode,
      safeStorage,
    )
    const broker = await startWorkBuddyTokenBroker(
      oauthClient,
      gate.workBuddySession,
      personalMemoryStore,
      weComAuthManager,
    )
    tokenBroker = broker
    await personalMemoryStore.read(gate.workBuddySession.workcode).catch(async (error: unknown) => {
      await recordDesktopEvent(userData,
        `个人本地记忆不可用: ${error instanceof Error ? error.message : String(error)}`)
    })
    const harnessHome = join(userData, 'harness-home')
    const managedSkillDir = join(harnessHome, 'hub-skills')
    const managedPluginDir = resolveManagedPluginRoot(harnessHome)
    const legacyManagedPluginDir = join(harnessHome, 'hub-plugins')
    const managedPluginPatch = join(harnessHome, 'hub-plugins.patch.yml')
    const managedInstructionDir = join(harnessHome, 'hub-instructions')
    const recovery = new ManagedCapabilityRecovery(harnessHome, {
      skillRoot: managedSkillDir,
      pluginRoot: managedPluginDir,
      pluginPatchPath: managedPluginPatch,
      instructionRoot: managedInstructionDir,
    })
    const prepared = await recovery.prepareBoot()
    let hubCatalog: HubCatalogSyncResult | undefined = prepared.result
    if (prepared.restored) {
      await recordDesktopEvent(userData, '检测到企业能力候选版本启动未完成，已恢复上一份健康版本')
    } else if (prepared.pendingCandidate) {
      await recordDesktopEvent(userData, '正在验证上次下载的企业能力候选版本')
    }
    if (hubCatalog === undefined) {
      const hubClient = new AiHubClient(aiHubBaseURL, gate.workBuddySession.accessToken)
      const latest = await hubClient.catalog()
      const existing = await recovery.readActiveResult()
      const latestRevisions = catalogRevisions(latest)
      const existingRevisions = existing === undefined ? undefined : catalogRevisions(existing.snapshot)
      const activationChanged = existingRevisions !== undefined
        && latestRevisions.activation !== existingRevisions.activation
      const gatewayChanged = existingRevisions !== undefined
        && latestRevisions.gateway !== existingRevisions.gateway
      const hotContentChanged = existingRevisions !== undefined
        && (latestRevisions.skills !== existingRevisions.skills
          || latestRevisions.instructions !== existingRevisions.instructions)
      const scheduled = activationChanged
        && await recovery.isActivationScheduled(latestRevisions.activation)
      if (existing === undefined || scheduled) {
        await recovery.stageUpdate()
        try {
          hubCatalog = await hubClient.synchronizeCatalog(
            managedSkillDir,
            managedPluginDir,
            managedPluginPatch,
            managedInstructionDir,
            latest,
          )
          await recovery.writeActiveResult(hubCatalog)
          await recovery.clearActivationSchedule()
          await recovery.markCurrentCandidateAttempted()
        } catch (error) {
          await recovery.rollback()
          throw error
        }
      } else if (!activationChanged && !gatewayChanged && !hotContentChanged) {
        await recovery.clearActivationSchedule()
        hubCatalog = existing
      } else if (!activationChanged && gatewayChanged && !hotContentChanged) {
        await recovery.clearActivationSchedule()
        hubCatalog = {
          ...existing,
          workBuddyEnabled: latest.mcps.some(item => item.tools.length > 0),
          snapshot: catalogSnapshot(latest),
        }
        await recovery.writeActiveResult(hubCatalog)
      } else if (activationChanged) {
        await recovery.clearActivationSchedule()
        if (!hotContentChanged) {
          hubCatalog = existing
        } else {
          hubCatalog = await hubClient.synchronizeCatalog(
            managedSkillDir,
            managedPluginDir,
            managedPluginPatch,
            managedInstructionDir,
            deferRestartBoundCatalog(existing.snapshot, latest),
            { preserveSkillRoot: true, preservePluginRoot: true },
          )
          await recovery.writeActiveResult(hubCatalog)
        }
      } else {
        hubCatalog = await hubClient.synchronizeCatalog(
          managedSkillDir,
          managedPluginDir,
          managedPluginPatch,
          managedInstructionDir,
          latest,
          { preserveSkillRoot: true, preservePluginRoot: true },
        )
        await recovery.writeActiveResult(hubCatalog)
      }
    }
    await rm(legacyManagedPluginDir, { recursive: true, force: true }).catch(async (error: unknown) => {
      await recordDesktopEvent(userData,
        `旧版客户端插件目录清理失败: ${error instanceof Error ? error.message : String(error)}`)
    })
    const installationId = await getOrCreateInstallationId(userData)
    const localWebAccessToken = randomUUID().replaceAll('-', '')
    await recordDesktopEvent(userData, `MCP 登录成功，已绑定工号 ${gate.workBuddySession.workcode}`)
    await recordDesktopEvent(userData,
      `模型访问校验成功，Provider=${gate.modelProvider}，网关返回 ${gate.models.length} 个模型`)
    await recordDesktopEvent(userData, `AI Hub 下发 ${hubCatalog.skillCount} 个 Skill，WorkBuddy MCP ${hubCatalog.workBuddyEnabled ? '已授权' : '未授权'}`)
    await recordDesktopEvent(userData, `AI Hub 下发 ${hubCatalog.pluginCount} 个客户端插件`)
    await recordDesktopEvent(userData, `AI Hub 下发 ${hubCatalog.instructionCount} 份企业托管指令`)
    const mainWindow = hardenedWindow({
      width: 1440,
      height: 920,
      minWidth: 900,
      minHeight: 640,
      title: 'Harness Enterprise Desktop',
      autoHideMenuBar: true,
      backgroundColor: '#101214',
      webPreferences: {
        preload: mainPreloadPath(),
        partition: `harness-runtime-${randomUUID()}`,
        additionalArguments: [`--dsh-desktop-version=${app.getVersion()}`],
      },
    })
    registerExternalNavigation(mainWindow, gate.language)
    mainWindow.on('page-title-updated', (event) => {
      event.preventDefault()
      mainWindow.setTitle('Harness Enterprise Desktop')
    })
    registerDesktopPreviewHandlers(mainWindow)
    registerDesktopAttachmentHandlers(mainWindow)
    registerPersonalMemoryHandlers(mainWindow, personalMemoryStore, gate.workBuddySession.workcode)
    registerEnterpriseAccountHandlers(mainWindow, broker.account, broker.revoke, userData)
    registerManagedUpdateHandlers(mainWindow, userData, gate.language)
    registerManagedSkillSetupHandlers(mainWindow, weComAuthManager)
    await mainWindow.loadURL(loadingDocument(gate.language))
    mainWindow.show()
    installDesktopTray(mainWindow, userData, gate.language)
    gate.closeLoginWindow()
    await recordDesktopEvent(userData, '主窗口已显示，开始启动后端')

    const config = loadDesktopConfig(launchEnvironment, gate.apiKey, gate.modelGatewayBaseURL)
    const workspace = await resolveWorkspace(config)
    const model = selectDefaultModel(gate.models, config.preferredModel)
    const launchRuntime = async (catalog: HubCatalogSyncResult): Promise<void> => {
      await bootMarker.update(app.getVersion(), 'starting-host')
      const url = await startBackend(
        workspace,
        childEnvironment(
          launchEnvironment,
          config,
          userData,
          model,
          broker,
          gate.language,
          aiHubBaseURL,
          managedSkillDir,
          catalog.managedInstructionFile,
          catalog.managedInstructionHashFile,
          catalog.workBuddyEnabled,
          catalog.snapshot,
          installationId,
          localWebAccessToken,
          weComCliPath,
        ),
        userData,
        managedPluginPatch,
      )
      await recordDesktopEvent(userData, '后端已就绪，正在加载主界面')
      installLocalWebAccess(mainWindow, url, localWebAccessToken)
      mainWindow.webContents.on('will-navigate', (event, target) => {
        if (new URL(target).origin !== new URL(url).origin) event.preventDefault()
      })
      const healthPromise = waitForRendererBootHealth(mainWindow)
      try {
        await mainWindow.loadURL(url)
      } catch (error) {
        void healthPromise.catch(() => {})
        throw error
      }
      const health = await healthPromise
      if (!health.ok) throw new Error(`客户端插件加载失败: ${health.error ?? '未知错误'}`)
      await recordDesktopEvent(userData, `Host、Web 与 ${health.entries.length} 个客户端插件健康检查通过`)
    }
    try {
      await launchRuntime(hubCatalog)
    } catch (candidateError) {
      await recordDesktopEvent(userData,
        `企业能力候选版本启动失败: ${candidateError instanceof Error ? candidateError.message : String(candidateError)}`)
      await stopBackendForRecovery()
      const fallback = await recovery.rollback()
      if (fallback === undefined) throw candidateError
      hubCatalog = fallback
      await mainWindow.loadURL(loadingDocument(gate.language))
      await recordDesktopEvent(userData, '正在自动恢复上一份健康企业能力')
      await launchRuntime(hubCatalog)
      if (Notification.isSupported()) {
        new Notification({
          title: gate.language === 'en' ? 'Capabilities restored' : '企业能力已回退',
          body: gate.language === 'en'
            ? 'A failed managed update was replaced by the previous healthy version.'
            : '新下发版本启动失败，已自动恢复上一份健康版本。',
        }).show()
      }
    }
    await recovery.markHealthy()
    await bootMarker.markHealthy()
    setDesktopHubStatus('synced')
    startCapabilitySync({
      broker,
      aiHubBaseURL,
      managedSkillDir,
      managedPluginDir,
      managedPluginPatch,
      managedInstructionDir,
      initial: hubCatalog,
      userData,
      recovery,
    })
    startDesktopUpdateChecks({
      mainWindow,
      broker,
      aiHubBaseURL,
      userData,
      language: gate.language,
    })
  } catch (error) {
    gate.closeLoginWindow()
    await recordDesktopEvent(userData, `启动失败: ${error instanceof Error ? error.message : String(error)}`)
    await showLaunchError(error, userData, launchLanguage)
    app.quit()
  }
}

async function runDesktopRuntimeSmoke(): Promise<void> {
  const patch = await readFile(patchPath(), 'utf8')
  if (!/id: webserver[\s\S]*host: 127\.0\.0\.1[\s\S]*port: 0/.test(patch)) {
    throw new Error('desktop runtime smoke: managed webserver host/port missing')
  }
  await stat(cliEntry())
  await stat(mainPreloadPath())
  const cliRequire = createRequire(cliEntry())
  cliRequire.resolve('@deepseek-ai/dsh-tools')
  cliRequire.resolve('@deepseek-ai/cordis-plugin-loader')
  require.resolve('fflate')
  require.resolve('@wecom/cli/package.json')
  if (await resolveWeComCliPath() === undefined) throw new Error('desktop runtime smoke: WeCom CLI is missing')
  process.stdout.write(`DSH_DESKTOP_RUNTIME_OK ${app.getVersion()} ${process.platform}-${process.arch}\n`)
}

configureStableUserDataPath()

if (process.argv.includes('--desktop-runtime-smoke') || process.env.DSH_DESKTOP_RUNTIME_SMOKE === '1') {
  void app.whenReady()
    .then(runDesktopRuntimeSmoke)
    .then(() => { app.exit(0) })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      app.exit(1)
    })
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    BrowserWindow.getAllWindows()[0]?.focus()
  })
  app.on('before-quit', () => {
    quitting = true
    if (capabilitySyncTimer !== undefined) clearInterval(capabilitySyncTimer)
    if (desktopUpdateInitialTimer !== undefined) clearTimeout(desktopUpdateInitialTimer)
    if (desktopUpdateTimer !== undefined) clearInterval(desktopUpdateTimer)
    stopBackend()
    void tokenBroker?.close()
    desktopTray?.destroy()
    desktopTray = undefined
  })
  app.on('render-process-gone', (_event, _contents, details) => {
    void activeBootMarker?.update(app.getVersion(), `renderer-${details.reason}`)
    const userData = app.getPath('userData')
    void recordDesktopEvent(userData,
      `Renderer 异常退出: reason=${details.reason},exitCode=${String(details.exitCode)}`)
  })
  app.on('child-process-gone', (_event, details) => {
    const userData = app.getPath('userData')
    void recordDesktopEvent(userData,
      `Electron 子进程异常退出: type=${details.type},reason=${details.reason},exitCode=${String(details.exitCode)}`)
  })
  process.on('uncaughtExceptionMonitor', (error) => {
    void activeBootMarker?.update(app.getVersion(), 'uncaught-exception')
    void recordDesktopEvent(app.getPath('userData'), `主进程未捕获异常: ${error.stack ?? error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    void recordDesktopEvent(app.getPath('userData'),
      `主进程未处理 Promise: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  void app.whenReady().then(() => {
    installThemeAwareApplicationIcon()
    return start()
  })
}
