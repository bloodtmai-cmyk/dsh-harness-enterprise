import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'

const MAX_AUTH_RESPONSE_BYTES = 1024 * 1024
const WORKCODE_PATTERN = /^[0-9]{5,12}$/
const DEFAULT_SCOPES = ['mcp.connect'] as const

export const MANAGED_WORKBUDDY_ISSUER = 'http://127.0.0.1:8090/enterprise-gateway'
export const MANAGED_WORKBUDDY_MCP_URL = `${MANAGED_WORKBUDDY_ISSUER}/mcp`
export const MANAGED_WORKBUDDY_REDIRECT_URI = 'workbuddy://enterprise-gateway/mcp/oauth/callback'

interface WorkBuddyOAuthClientOptions {
  issuer?: string
  mcpURL?: string
  redirectURI?: string
  fetch?: typeof fetch
  verifyAccessToken?: (accessToken: string) => Promise<JWTPayload>
}

interface OAuthTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
}

interface PasswordLoginResponse {
  message?: unknown
  data?: { redirectUrl?: unknown }
}

export interface WorkBuddyOAuthSession {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  workcode: string
  profile: WorkBuddyEnterpriseProfile
  clientId: string
  scope: string
}

/** Sanitized identity attributes read only from a verified enterprise access token. */
export interface WorkBuddyEnterpriseProfile {
  providerId: string
  displayName?: string
  department?: string
  departmentCodes: string[]
  jobTitle?: string
  email?: string
  phone?: string
}

export class WorkBuddyOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options)
    this.name = 'WorkBuddyOAuthError'
  }
}

export function isCredentialRejection(error: unknown): boolean {
  return error instanceof WorkBuddyOAuthError
    && (error.code === 'INVALID_CREDENTIALS' || error.code === 'AD_USER_NOT_FOUND')
}

class CookieJar {
  private readonly values = new Map<string, string>()

  capture(headers: Headers): void {
    const setCookies = headers.getSetCookie()
    for (const cookie of setCookies) {
      const pair = cookie.split(';', 1)[0]
      const separator = pair?.indexOf('=') ?? -1
      if (pair === undefined || separator <= 0) continue
      this.values.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  header(): string | undefined {
    if (this.values.size === 0) return undefined
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

function normalizeWorkcode(raw: unknown): string {
  const workcode = typeof raw === 'string'
    ? raw.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
    : ''
  if (!WORKCODE_PATTERN.test(workcode)) {
    throw new WorkBuddyOAuthError('INVALID_WORKCODE', '请输入 5 到 12 位数字工号。')
  }
  return workcode
}

function normalizePassword(raw: unknown): string {
  const password = typeof raw === 'string' ? raw : ''
  if (password.length === 0 || password.length > 256) {
    throw new WorkBuddyOAuthError('INVALID_PASSWORD', '请输入密码。')
  }
  return password
}

function location(response: Response, baseURL: string): URL {
  const value = response.headers.get('location')
  if (value === null) throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务返回了无效跳转。')
  return new URL(value, baseURL)
}

function matchesRedirectURI(candidate: URL, redirectURI: string): boolean {
  const expected = new URL(redirectURI)
  return candidate.protocol === expected.protocol
    && candidate.username === expected.username
    && candidate.password === expected.password
    && candidate.host === expected.host
    && candidate.pathname === expected.pathname
}

function passwordAuthenticateURL(loginURL: URL, issuer: string): URL {
  const issuerURL = new URL(issuer)
  if (loginURL.origin !== issuerURL.origin || loginURL.username !== '' || loginURL.password !== '') {
    throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务返回了不受信任的域认证地址。')
  }
  const pathname = loginURL.pathname.replace(/\/+$/, '')
  if (pathname === '') {
    throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务返回了无效的域认证地址。')
  }
  return new URL(`${pathname}/authenticate`, issuerURL)
}

async function responseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_AUTH_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务响应过大。')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_AUTH_RESPONSE_BYTES) {
    throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务响应过大。')
  }
  return text
}

function loginFailure(status: number, html: string): WorkBuddyOAuthError {
  const known: ReadonlyArray<readonly [string, string, string]> = [
    ['请输入裸工号，不要附加域名或邮箱后缀', 'INVALID_WORKCODE', '请输入有效工号。'],
    ['工号或密码错误', 'INVALID_CREDENTIALS', '工号或密码不正确。'],
    ['当前时段不允许登录', 'AD_LOGON_TIME_RESTRICTED', '当前时间不允许该账号登录。'],
    ['当前设备不允许登录', 'AD_WORKSTATION_RESTRICTED', '该账号不允许从当前设备登录。'],
    ['域控密码已过期', 'AD_PASSWORD_EXPIRED', '该账号密码已过期。'],
    ['域控账号已禁用', 'AD_ACCOUNT_DISABLED', '该域账号已被禁用。'],
    ['域控账号已过期', 'AD_ACCOUNT_EXPIRED', '该域账号已过期。'],
    ['域控密码需要重置', 'AD_PASSWORD_RESET_REQUIRED', '该账号必须先修改密码。'],
    ['域控账号已锁定', 'AD_ACCOUNT_LOCKED', '该域账号已被锁定，请联系管理员解锁。'],
    ['域控暂时不可用', 'DIRECTORY_UNREACHABLE', '无法连接域控，请检查当前网络。'],
    ['域控认证失败', 'DIRECTORY_ERROR', '域控登录暂不可用，请联系 IT 管理员。'],
    ['域控登录未正确配置', 'WORKBUDDY_UNAVAILABLE', 'MCP 登录服务暂不可用，请联系 IT 管理员。'],
    ['域控未返回对应工号', 'AD_USER_NOT_FOUND', '未找到该工号，请检查后重试。'],
    ['域控工号映射异常', 'WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务返回了无效的工号映射。'],
    ['域控返回的工号与登录工号不一致', 'WORKBUDDY_IDENTITY_MISMATCH', 'MCP 登录工号与应用登录工号不一致。'],
  ]
  for (const [needle, code, message] of known) {
    if (html.includes(needle)) return new WorkBuddyOAuthError(code, message)
  }
  if (status === 403) {
    return new WorkBuddyOAuthError(
      'WORKBUDDY_LOGIN_REJECTED',
      '企业认证服务拒绝建立登录会话，请联系 IT 管理员。',
    )
  }
  if (status === 429) {
    return new WorkBuddyOAuthError('RATE_LIMITED', '尝试次数过多，请稍后重新登录。')
  }
  return new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务返回了无法识别的认证错误。')
}

function normalizedProfileString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 256)
  return normalized === '' ? undefined : normalized
}

function normalizedDepartmentCodes(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(/[,;]/) : []
  const unique = new Set<string>()
  for (const candidate of candidates) {
    const normalized = normalizedProfileString(candidate)
    if (normalized !== undefined) unique.add(normalized)
    if (unique.size === 16) break
  }
  return [...unique]
}

function firstProfileString(payload: JWTPayload, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizedProfileString(payload[key])
    if (value !== undefined) return value
  }
  return undefined
}

function authenticationProvider(startURL: URL): string {
  const segments = startURL.pathname.split('/').filter(Boolean)
  const oauthSegment = segments.lastIndexOf('oauth2')
  const candidate = oauthSegment >= 0 ? segments[oauthSegment + 1] : undefined
  return typeof candidate === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate)
    ? candidate
    : 'enterprise'
}

function enterpriseProfile(
  payload: JWTPayload,
  providerId: string,
  previous?: WorkBuddyEnterpriseProfile,
): WorkBuddyEnterpriseProfile {
  const currentCodes = normalizedDepartmentCodes(payload.department_codes ?? payload.departmentCodes)
  const optional = <K extends keyof WorkBuddyEnterpriseProfile>(
    key: K,
    value: WorkBuddyEnterpriseProfile[K] | undefined,
  ): Partial<WorkBuddyEnterpriseProfile> => value === undefined ? {} : { [key]: value }
  return {
    providerId,
    ...optional('displayName', firstProfileString(payload, ['name', 'display_name', 'displayName']) ?? previous?.displayName),
    ...optional('department', firstProfileString(payload, ['department_name', 'department']) ?? previous?.department),
    departmentCodes: currentCodes.length > 0 ? currentCodes : previous?.departmentCodes ?? [],
    ...optional('jobTitle', firstProfileString(payload, ['job_title', 'title']) ?? previous?.jobTitle),
    ...optional('email', firstProfileString(payload, ['email', 'mail']) ?? previous?.email),
    ...optional('phone', firstProfileString(payload, ['phone_number', 'mobile', 'telephone_number']) ?? previous?.phone),
  }
}

async function verifiedIdentity(
  accessToken: string,
  verifyAccessToken: (value: string) => Promise<JWTPayload>,
  providerId: string,
  previous?: WorkBuddyEnterpriseProfile,
): Promise<{ workcode: string; profile: WorkBuddyEnterpriseProfile }> {
  try {
    const payload = await verifyAccessToken(accessToken)
    return {
      workcode: normalizeWorkcode(payload.workcode),
      profile: enterpriseProfile(payload, providerId, previous),
    }
  } catch (error) {
    throw new WorkBuddyOAuthError('WORKBUDDY_TOKEN_INVALID', 'MCP 登录凭据缺少工号。', { cause: error })
  }
}

export class WorkBuddyOAuthClient {
  private readonly issuer: string
  private readonly mcpURL: string
  private readonly redirectURI: string
  private readonly fetcher: typeof fetch
  private readonly verifyAccessToken: (accessToken: string) => Promise<JWTPayload>

  constructor(options: WorkBuddyOAuthClientOptions = {}) {
    this.issuer = (options.issuer ?? MANAGED_WORKBUDDY_ISSUER).replace(/\/+$/, '')
    this.mcpURL = options.mcpURL ?? MANAGED_WORKBUDDY_MCP_URL
    this.redirectURI = options.redirectURI ?? MANAGED_WORKBUDDY_REDIRECT_URI
    this.fetcher = options.fetch ?? fetch
    const jwks = createRemoteJWKSet(new URL(`${this.issuer}/oauth2/jwks`))
    this.verifyAccessToken = options.verifyAccessToken ?? (async (accessToken: string) => {
      const verified = await jwtVerify(accessToken, jwks, {
        issuer: this.issuer,
        audience: this.mcpURL,
        algorithms: ['RS256'],
      })
      return verified.payload
    })
  }

  async authenticate(rawWorkcode: unknown, rawPassword: unknown): Promise<WorkBuddyOAuthSession> {
    const workcode = normalizeWorkcode(rawWorkcode)
    const password = normalizePassword(rawPassword)
    const clientId = await this.registerClient()
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const oauthState = randomBytes(24).toString('base64url')
    const jar = new CookieJar()
    const authorizeURL = new URL(`${this.issuer}/oauth2/authorize`)
    authorizeURL.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.redirectURI,
      scope: DEFAULT_SCOPES.join(' '),
      state: oauthState,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: this.mcpURL,
    }).toString()

    const authorize = await this.request(authorizeURL, { method: 'GET' }, jar)
    if (authorize.status < 300 || authorize.status >= 400) {
      await authorize.body?.cancel()
      throw new WorkBuddyOAuthError('WORKBUDDY_UNAVAILABLE', 'MCP 登录服务暂不可用。')
    }
    const startURL = location(authorize, authorizeURL.toString())
    const providerId = authenticationProvider(startURL)
    await authorize.body?.cancel()
    const start = await this.request(startURL, { method: 'GET' }, jar)
    if (start.status < 300 || start.status >= 400) {
      await start.body?.cancel()
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务没有进入域认证流程。')
    }
    const loginURL = location(start, startURL.toString())
    await start.body?.cancel()
    const ldapState = loginURL.searchParams.get('state')
    if (ldapState === null || ldapState.length === 0) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务缺少域认证状态。')
    }
    const loginPage = await this.request(loginURL, { method: 'GET' }, jar)
    if (!loginPage.ok) {
      const html = await responseText(loginPage)
      throw loginFailure(loginPage.status, html)
    }
    await loginPage.body?.cancel()

    const passwordRedirectURI = loginURL.searchParams.get('redirect_uri')
    let nextURL = passwordRedirectURI === null
      ? await this.submitLegacyPassword(workcode, password, ldapState, jar)
      : await this.submitPassword(workcode, password, ldapState, passwordRedirectURI, loginURL, jar)
    let callbackURL: URL | undefined
    for (let redirects = 0; redirects < 6; redirects += 1) {
      if (matchesRedirectURI(nextURL, this.redirectURI)) {
        callbackURL = nextURL
        break
      }
      const response = await this.request(nextURL, { method: 'GET' }, jar)
      if (response.status < 300 || response.status >= 400) {
        await response.body?.cancel()
        throw new WorkBuddyOAuthError('WORKBUDDY_CONSENT_REQUIRED', 'MCP 授权需要管理员调整客户端授权策略。')
      }
      const current = nextURL.toString()
      nextURL = location(response, current)
      await response.body?.cancel()
    }
    if (callbackURL === undefined) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录跳转次数过多。')
    }
    if (callbackURL.searchParams.get('state') !== oauthState) {
      throw new WorkBuddyOAuthError('WORKBUDDY_STATE_MISMATCH', 'MCP 登录状态校验失败。')
    }
    const code = callbackURL.searchParams.get('code')
    if (code === null || code.length === 0) {
      throw new WorkBuddyOAuthError('WORKBUDDY_AUTHORIZATION_FAILED', 'MCP 登录没有返回授权码。')
    }
    const session = await this.exchangeToken(new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: this.redirectURI,
      code,
      code_verifier: verifier,
      resource: this.mcpURL,
    }), clientId, undefined, providerId)
    if (session.workcode !== workcode) {
      throw new WorkBuddyOAuthError('WORKBUDDY_IDENTITY_MISMATCH', 'MCP 登录工号与应用登录工号不一致。')
    }
    return session
  }

  private async submitPassword(
    workcode: string,
    password: string,
    state: string,
    redirectURI: string,
    loginURL: URL,
    jar: CookieJar,
  ): Promise<URL> {
    const endpoint = passwordAuthenticateURL(loginURL, this.issuer)
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userNo: workcode, password, redirectUri: redirectURI, state }),
    }, jar)
    const text = await responseText(response)
    let payload: PasswordLoginResponse
    try {
      payload = JSON.parse(text) as PasswordLoginResponse
    } catch (error) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', '企业认证服务返回了无效数据。', { cause: error })
    }
    const message = typeof payload.message === 'string' ? payload.message : text
    if (!response.ok) throw loginFailure(response.status, message)
    const redirectURL = payload.data?.redirectUrl
    if (typeof redirectURL !== 'string' || redirectURL.length === 0) {
      throw loginFailure(response.status, message)
    }
    try {
      return new URL(redirectURL, loginURL)
    } catch (error) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', '企业认证服务返回了无效跳转。', { cause: error })
    }
  }

  private async submitLegacyPassword(
    workcode: string,
    password: string,
    state: string,
    jar: CookieJar,
  ): Promise<URL> {
    const endpoint = new URL(`${this.issuer}/oauth2/ldap/login`)
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ workcode, password, state }),
    }, jar)
    if (response.status < 300 || response.status >= 400) {
      const html = await responseText(response)
      throw loginFailure(response.status, html)
    }
    const nextURL = location(response, endpoint.toString())
    await response.body?.cancel()
    return nextURL
  }

  async refresh(session: WorkBuddyOAuthSession): Promise<WorkBuddyOAuthSession> {
    if (session.refreshToken === undefined) {
      throw new WorkBuddyOAuthError('WORKBUDDY_SESSION_EXPIRED', 'MCP 登录已过期，请重新启动应用登录。')
    }
    return await this.exchangeToken(new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: session.clientId,
      refresh_token: session.refreshToken,
      scope: session.scope,
      resource: this.mcpURL,
    }), session.clientId, session, session.profile.providerId)
  }

  /** Best-effort remote session revocation used by the desktop sign-out flow. */
  async revoke(session: WorkBuddyOAuthSession): Promise<void> {
    const response = await this.fetcher(`${this.issuer}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: session.clientId,
        token: session.refreshToken ?? session.accessToken,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    }).catch((error: unknown) => {
      throw new WorkBuddyOAuthError('WORKBUDDY_UNAVAILABLE', '无法连接企业认证退出服务。', { cause: error })
    })
    await response.body?.cancel()
    if (!response.ok) {
      throw new WorkBuddyOAuthError('WORKBUDDY_LOGOUT_FAILED', '企业认证服务没有确认退出。')
    }
  }

  private async registerClient(): Promise<string> {
    const response = await this.fetcher(`${this.issuer}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Harness Enterprise Desktop',
        redirect_uris: [this.redirectURI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new WorkBuddyOAuthError('WORKBUDDY_UNAVAILABLE', '无法连接 MCP 登录服务。', { cause: error })
    })
    const text = await responseText(response)
    if (!response.ok) throw new WorkBuddyOAuthError('WORKBUDDY_CLIENT_REJECTED', 'Harness Enterprise Desktop尚未获准连接 MCP。')
    try {
      const body = JSON.parse(text) as { client_id?: unknown }
      if (typeof body.client_id !== 'string' || body.client_id.length === 0) throw new Error('missing client_id')
      return body.client_id
    } catch (error) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP 登录服务没有返回客户端标识。', { cause: error })
    }
  }

  private async exchangeToken(
    parameters: URLSearchParams,
    clientId: string,
    previous?: WorkBuddyOAuthSession,
    providerId = previous?.profile.providerId ?? 'enterprise',
  ): Promise<WorkBuddyOAuthSession> {
    const response = await this.fetcher(`${this.issuer}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: parameters,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new WorkBuddyOAuthError('WORKBUDDY_UNAVAILABLE', '无法连接 MCP Token 服务。', { cause: error })
    })
    const text = await responseText(response)
    if (!response.ok) {
      throw new WorkBuddyOAuthError('WORKBUDDY_SESSION_EXPIRED', 'MCP 登录已失效，请重新启动应用登录。')
    }
    let body: OAuthTokenResponse
    try {
      body = JSON.parse(text) as OAuthTokenResponse
    } catch (error) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP Token 服务返回了无效数据。', { cause: error })
    }
    if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new WorkBuddyOAuthError('WORKBUDDY_PROTOCOL_ERROR', 'MCP Token 服务没有返回访问凭据。')
    }
    const identity = await verifiedIdentity(
      body.access_token,
      this.verifyAccessToken,
      providerId,
      previous?.profile,
    )
    if (previous !== undefined && previous.workcode !== identity.workcode) {
      throw new WorkBuddyOAuthError('WORKBUDDY_IDENTITY_MISMATCH', 'MCP 刷新后的工号发生变化。')
    }
    const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? Math.max(60, body.expires_in)
      : 300
    return {
      accessToken: body.access_token,
      ...typeof body.refresh_token === 'string' && body.refresh_token.length > 0
        ? { refreshToken: body.refresh_token }
        : previous?.refreshToken === undefined ? {} : { refreshToken: previous.refreshToken },
      expiresAt: Date.now() + expiresIn * 1_000,
      workcode: identity.workcode,
      profile: identity.profile,
      clientId,
      scope: typeof body.scope === 'string' && body.scope.length > 0
        ? body.scope
        : previous?.scope ?? DEFAULT_SCOPES.join(' '),
    }
  }

  private async request(url: URL, init: RequestInit, jar: CookieJar): Promise<Response> {
    const headers = new Headers(init.headers)
    const cookie = jar.header()
    if (cookie !== undefined) headers.set('Cookie', cookie)
    let response: Response
    try {
      response = await this.fetcher(url, {
        ...init,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      throw new WorkBuddyOAuthError('WORKBUDDY_UNAVAILABLE', '无法连接 MCP 登录服务。', { cause: error })
    }
    jar.capture(response.headers)
    return response
  }
}
