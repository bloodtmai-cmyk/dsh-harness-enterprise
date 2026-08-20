const form = document.querySelector('#login-form')
const directoryPanel = document.querySelector('#directory-panel')
const ambientCanvas = document.querySelector('#ambient-canvas')
const workcodeInput = document.querySelector('#workcode')
const passwordInput = document.querySelector('#password')
const submitButton = document.querySelector('#submit-button')
const buttonLabel = submitButton.querySelector('.button-label')
const feedback = document.querySelector('#feedback')
const keyPanel = document.querySelector('#key-panel')
const keyForm = document.querySelector('#key-form')
const keySubmitButton = document.querySelector('#key-submit-button')
const keyButtonLabel = keySubmitButton.querySelector('.button-label')
const keyFeedback = document.querySelector('#key-feedback')
const languageSwitches = [...document.querySelectorAll('.language-switch')]
const languageButtons = [...document.querySelectorAll('[data-language]')]
const feedbackTimers = new WeakMap()
const FEEDBACK_AUTO_DISMISS_MS = 4_000

const translations = {
  zh: {
    documentTitle: '登录 - Harness Enterprise Desktop',
    languageLabel: '工作语言',
    productSubtitle: '企业智能工作台',
    accountSection: '企业账号',
    loginTitle: '登录',
    workcode: '工号',
    password: '密码',
    modelSection: 'AI Hub',
    keyTitle: 'API Key 申请',
    footer: '企业身份验证',
    login: '登录',
    validating: '正在验证',
    loginSuccess: '登录成功',
    launching: '正在启动',
    continue: '提交申请',
    retry: '刷新状态',
    connecting: '正在同步',
    workcodeRequired: '请输入工号',
    passwordRequired: '请输入密码',
    loginFailed: '登录失败，请稍后重试。',
    loginServiceUnavailable: '登录服务暂不可用，请重新启动应用。',
    modelFailed: '模型服务连接失败。',
    modelServiceUnavailable: '模型服务连接失败，请重新启动应用。',
  },
  en: {
    documentTitle: 'Sign in - Harness Enterprise Desktop',
    languageLabel: 'Working language',
    productSubtitle: 'Enterprise intelligent workspace',
    accountSection: 'Corporate account',
    loginTitle: 'Sign in',
    workcode: 'Workcode',
    password: 'Password',
    modelSection: 'AI Hub',
    keyTitle: 'API Key access',
    footer: 'Enterprise identity verification',
    login: 'Sign in',
    validating: 'Verifying',
    loginSuccess: 'Signed in',
    launching: 'Starting',
    continue: 'Submit request',
    retry: 'Refresh status',
    connecting: 'Syncing',
    workcodeRequired: 'Enter your workcode.',
    passwordRequired: 'Enter your password.',
    loginFailed: 'Sign-in failed. Please try again later.',
    loginServiceUnavailable: 'The sign-in service is unavailable. Restart the app and try again.',
    modelFailed: 'Could not connect to the model service.',
    modelServiceUnavailable: 'Could not connect to the model service. Restart the app and try again.',
  },
}

const errorMessages = {
  INVALID_WORKCODE: ['请输入有效工号。', 'Enter a valid workcode.'],
  INVALID_PASSWORD: ['请输入密码。', 'Enter your password.'],
  AD_USER_NOT_FOUND: ['未找到该工号，请检查后重试。', 'Workcode not found. Check it and try again.'],
  INVALID_CREDENTIALS: ['工号或密码不正确。', 'The workcode or password is incorrect.'],
  AD_LOGON_TIME_RESTRICTED: ['当前时间不允许该账号登录。', 'This account cannot sign in at the current time.'],
  AD_WORKSTATION_RESTRICTED: ['该账号不允许从当前设备登录。', 'This account cannot sign in from this device.'],
  AD_PASSWORD_EXPIRED: ['该账号密码已过期。', 'This account password has expired.'],
  AD_ACCOUNT_DISABLED: ['该域账号已被禁用。', 'This directory account has been disabled.'],
  AD_ACCOUNT_EXPIRED: ['该域账号已过期。', 'This directory account has expired.'],
  AD_PASSWORD_RESET_REQUIRED: ['该账号必须先修改密码。', 'This account must change its password before signing in.'],
  AD_ACCOUNT_LOCKED: ['该域账号已被锁定，请联系管理员解锁。', 'This directory account is locked. Contact an administrator.'],
  TLS_CERTIFICATE_ERROR: ['域控安全连接验证失败，请联系 IT 管理员。', 'Directory TLS verification failed. Contact IT.'],
  DIRECTORY_TIMEOUT: ['域控响应超时，请检查网络后重试。', 'The directory request timed out. Check your network and try again.'],
  DIRECTORY_UNREACHABLE: ['无法连接域控，请检查当前网络。', 'The directory service is unreachable. Check your network.'],
  DIRECTORY_ERROR: ['域控登录暂不可用，请联系 IT 管理员。', 'Directory sign-in is unavailable. Contact IT.'],
  WORKBUDDY_ACCESS_DENIED: ['当前工号没有可用的 WMS MCP 权限。', 'This account has no available WMS MCP permissions.'],
  WORKBUDDY_UNAVAILABLE: ['MCP 登录服务暂不可用，请检查当前网络。', 'The MCP sign-in service is unavailable. Check your network.'],
  WORKBUDDY_CLIENT_REJECTED: ['Harness Enterprise Desktop 尚未获准连接 MCP，请联系 IT 管理员。', 'Harness Enterprise Desktop is not authorized to connect to MCP. Contact IT.'],
  WORKBUDDY_LOGIN_REJECTED: ['企业认证服务拒绝建立登录会话，请联系 IT 管理员。', 'The corporate identity service rejected this sign-in. Contact IT.'],
  WORKBUDDY_PROTOCOL_ERROR: ['MCP 登录服务响应异常，请联系 IT 管理员。', 'The MCP sign-in service returned an invalid response. Contact IT.'],
  WORKBUDDY_CONSENT_REQUIRED: ['MCP 授权策略尚未适配 Harness Enterprise Desktop，请联系 IT 管理员。', 'The MCP authorization policy is not ready for Harness Enterprise Desktop. Contact IT.'],
  WORKBUDDY_STATE_MISMATCH: ['MCP 登录状态校验失败，请重启应用。', 'MCP sign-in state validation failed. Restart the app.'],
  WORKBUDDY_AUTHORIZATION_FAILED: ['MCP 授权失败，请重试。', 'MCP authorization failed. Try again.'],
  WORKBUDDY_TOKEN_INVALID: ['MCP 登录凭据无效，请重试。', 'The MCP sign-in credential is invalid. Try again.'],
  WORKBUDDY_IDENTITY_MISMATCH: ['MCP 登录工号与应用登录工号不一致。', 'The MCP identity does not match the application sign-in.'],
  WORKBUDDY_SESSION_EXPIRED: ['MCP 登录已失效，请重新启动应用登录。', 'The MCP sign-in has expired. Restart the app and sign in again.'],
  KEY_APPLICATION_REQUIRED: ['尚未申请 API Key，请提交申请。', 'No API Key request exists. Submit one to continue.'],
  KEY_APPLICATION_PENDING: ['API Key 申请已提交，请等待管理员审批。', 'The API Key request was submitted. Wait for administrator approval.'],
  KEY_ALREADY_CLAIMED: ['API Key 已领取，但本机没有凭据，请联系管理员重新签发。', 'The API Key was already claimed on another installation. Contact an administrator.'],
  AI_HUB_UNAVAILABLE: ['AI Hub 暂不可用，请稍后重试。', 'AI Hub is unavailable. Try again later.'],
  INVALID_MODEL_KEY: ['API Key 无效或没有模型访问权限。', 'The API Key is invalid or has no model access.'],
  MODEL_GATEWAY_UNAVAILABLE: ['模型服务暂不可用，请检查当前网络或稍后重试。', 'The model service is unavailable. Check your network or try again later.'],
  INVALID_AUTH_CONTEXT: ['登录上下文无效，请重新启动应用。', 'The sign-in session is invalid. Restart the app.'],
  AUTH_IN_PROGRESS: ['正在验证，请稍候。', 'Verification is already in progress.'],
  KEY_CHECK_IN_PROGRESS: ['正在验证，请稍候。', 'API Key verification is already in progress.'],
  INVALID_LANGUAGE: ['请选择有效语言。', 'Select a valid language.'],
  LANGUAGE_SAVE_FAILED: ['无法保存语言设置，请联系 IT 管理员。', 'Could not save the language setting. Contact IT.'],
  SAVED_KEY_REJECTED: ['AI Hub 签发的 API Key 暂不可用，请联系管理员或稍后重试。', 'The AI Hub API Key is unavailable. Contact an administrator or try again later.'],
  SAVED_KEY_UNAVAILABLE: ['模型服务暂不可用，已保存的 API Key 会继续保留，请稍后重试。', 'The model service is unavailable. Your saved API Key is still retained; try again later.'],
}

const queryLanguage = new URLSearchParams(window.location.search).get('language')
let language = queryLanguage === 'en' ? 'en' : 'zh'
let loginStatus = 'idle'
let keyStatus = 'idle'
let keyMode = 'application'

function t(key) {
  return translations[language][key]
}

function localizedError(result, fallbackKey) {
  if (result?.code === 'RATE_LIMITED') {
    const seconds = Number.isFinite(result.retryAfterSeconds) ? result.retryAfterSeconds : 30
    return language === 'en'
      ? `Too many failed attempts. Try again in ${seconds} seconds.`
      : `连续登录失败，请 ${seconds} 秒后重试。`
  }
  const messages = errorMessages[result?.code]
  if (messages !== undefined) return messages[language === 'en' ? 1 : 0]
  return result?.message || t(fallbackKey)
}

function renderFeedback(target) {
  const state = target.feedbackState
  if (state === undefined) return
  const message = state.result === undefined
    ? t(state.fallbackKey)
    : localizedError(state.result, state.fallbackKey)
  target.textContent = state.diagnosticCode ? `${message} (${state.diagnosticCode})` : message
}

function showError(target, fallbackKey, result) {
  const previousTimer = feedbackTimers.get(target)
  if (previousTimer !== undefined) window.clearTimeout(previousTimer)
  target.feedbackState = {
    fallbackKey,
    result,
    diagnosticCode: result?.diagnosticCode,
  }
  renderFeedback(target)
  target.hidden = false
  const timer = window.setTimeout(() => clearError(target), FEEDBACK_AUTO_DISMISS_MS)
  feedbackTimers.set(target, timer)
}

function clearError(target) {
  const timer = feedbackTimers.get(target)
  if (timer !== undefined) window.clearTimeout(timer)
  feedbackTimers.delete(target)
  target.hidden = true
  target.feedbackState = undefined
}

function updateControls() {
  buttonLabel.textContent = loginStatus === 'busy'
    ? t('validating')
    : loginStatus === 'success'
      ? t('loginSuccess')
      : loginStatus === 'launching'
        ? t('launching')
        : t('login')
  submitButton.dataset.busy = String(loginStatus === 'busy')
  submitButton.disabled = loginStatus !== 'idle'
  workcodeInput.disabled = loginStatus !== 'idle'
  passwordInput.disabled = loginStatus !== 'idle'

  keyButtonLabel.textContent = keyStatus === 'busy'
    ? t('connecting')
    : keyStatus === 'launching'
      ? t('launching')
      : keyMode === 'saved'
        ? t('retry')
        : t('continue')
  keySubmitButton.dataset.busy = String(keyStatus === 'busy')
  keySubmitButton.disabled = keyStatus !== 'idle'

  const languageLocked = loginStatus === 'busy'
    || loginStatus === 'launching'
    || keyStatus === 'busy'
    || keyStatus === 'launching'
  for (const button of languageButtons) button.disabled = languageLocked
}

function applyLanguage() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  document.title = t('documentTitle')
  for (const languageSwitch of languageSwitches) languageSwitch.setAttribute('aria-label', t('languageLabel'))
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n)
  }
  for (const button of languageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language))
  }
  renderFeedback(feedback)
  renderFeedback(keyFeedback)
  updateControls()
}

function showKeyStep(result) {
  keyMode = result.nextStep === 'retry-saved-key'
    ? 'saved'
    : result.code === 'KEY_APPLICATION_REQUIRED'
      ? 'application'
      : 'retry'
  loginStatus = 'success'
  keyStatus = 'idle'
  directoryPanel.hidden = true
  keyPanel.hidden = false
  keyPanel.prepend(ambientCanvas)
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  clearError(keyFeedback)
  if (result.code !== undefined || result.message) showError(keyFeedback, 'modelFailed', result)
  updateControls()
  keySubmitButton.focus()
}

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    language = button.dataset.language === 'en' ? 'en' : 'zh'
    applyLanguage()
  })
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  clearError(feedback)
  const workcode = workcodeInput.value.trim()
  const password = passwordInput.value
  if (workcode.length === 0) {
    showError(feedback, 'workcodeRequired')
    workcodeInput.focus()
    return
  }
  if (password.length === 0) {
    showError(feedback, 'passwordRequired')
    passwordInput.focus()
    return
  }

  loginStatus = 'busy'
  updateControls()
  try {
    const result = await window.desktopAuth.login({ workcode, password, language })
    if (!result.ok) {
      loginStatus = 'idle'
      updateControls()
      showError(feedback, 'loginFailed', result)
      passwordInput.value = ''
      passwordInput.focus()
      return
    }
    if (result.nextStep === 'launching') {
      loginStatus = 'launching'
      return
    }
    showKeyStep(result)
  } catch {
    showError(feedback, 'loginServiceUnavailable')
  } finally {
    if (loginStatus === 'busy') loginStatus = 'idle'
    updateControls()
  }
})

keyForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  clearError(keyFeedback)

  keyStatus = 'busy'
  updateControls()
  try {
    const result = keyMode === 'saved'
      ? await window.desktopAuth.retrySavedModelKey({ language })
      : await window.desktopAuth.requestHubKey({ action: keyMode === 'application' ? 'apply' : 'retry', language })
    if (!result.ok) {
      keyStatus = 'idle'
      updateControls()
      showError(keyFeedback, 'modelFailed', result)
      return
    }
    if (result.nextStep === 'hub-key' || result.nextStep === 'retry-saved-key') {
      showKeyStep(result)
      return
    }
    keyStatus = 'launching'
  } catch {
    showError(keyFeedback, 'modelServiceUnavailable')
  } finally {
    if (keyStatus === 'busy') keyStatus = 'idle'
    updateControls()
  }
})

applyLanguage()
