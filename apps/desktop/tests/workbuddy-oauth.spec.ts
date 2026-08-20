import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCredentialRejection,
  WorkBuddyOAuthClient,
  WorkBuddyOAuthError,
} from '../src/workbuddy-oauth.ts'
import type { WorkBuddyOAuthSession } from '../src/workbuddy-oauth.ts'
import { startWorkBuddyTokenBroker } from '../src/workbuddy-token-broker.ts'
import type { PersonalMemoryStore } from '../src/personal-memory-store.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

function jwt(workcode: string, generation: number, claims: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ workcode, generation, ...claims })).toString('base64url')
  return `${header}.${payload}.signature`
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

function redirect(response: ServerResponse, location: string, cookie?: string): void {
  response.writeHead(302, {
    Location: location,
    ...cookie === undefined ? {} : { 'Set-Cookie': cookie },
  })
  response.end()
}

async function oauthFixture(options: {
  loginFailure?: { html: string; status?: number }
  loginProtocol?: 'current' | 'legacy'
  password?: string
  tokenWorkcode?: string
  tokenClaims?: Record<string, unknown>
  workcode?: string
} = {}): Promise<{
  client: WorkBuddyOAuthClient
  revokedTokens: () => string[]
  tokenRequests: () => number
}> {
  const acceptedPassword = options.password ?? 'correct-password'
  const acceptedWorkcode = options.workcode ?? '0104462'
  const tokenWorkcode = options.tokenWorkcode ?? acceptedWorkcode
  const loginProtocol = options.loginProtocol ?? 'current'
  let oauthState = ''
  let tokenRequests = 0
  const revokedTokens: string[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const url = new URL(request.url ?? '/', origin)
      if (request.method === 'POST' && url.pathname === '/workbuddy-mcp/oauth2/register') {
        response.writeHead(201, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ client_id: 'dsh-harness-test' }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/workbuddy-mcp/oauth2/authorize') {
        oauthState = url.searchParams.get('state') ?? ''
        redirect(response, loginProtocol === 'current'
          ? '/workbuddy-mcp/oauth2/directory-password/start'
          : '/workbuddy-mcp/oauth2/ldap/start', 'JSESSIONID=test-session; Path=/; HttpOnly')
        return
      }
      if (request.method === 'GET'
        && (url.pathname === '/workbuddy-mcp/oauth2/directory-password/start'
          || url.pathname === '/workbuddy-mcp/oauth2/ldap/start')) {
        expect(request.headers.cookie).toContain('JSESSIONID=test-session')
        redirect(response, loginProtocol === 'current'
          ? `/directory/password-login?redirect_uri=${encodeURIComponent(`${origin}/workbuddy-mcp/oauth2/directory-password/callback`)}&state=ldap-state`
          : '/workbuddy-mcp/oauth2/ldap/login?state=ldap-state')
        return
      }
      if (request.method === 'GET'
        && (url.pathname === '/directory/password-login'
          || url.pathname === '/workbuddy-mcp/oauth2/ldap/login')) {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<form></form>')
        return
      }
      if (request.method === 'POST' && url.pathname === '/directory/password-login/authenticate') {
        const fields = JSON.parse(await body(request)) as {
          userNo?: unknown
          password?: unknown
          redirectUri?: unknown
          state?: unknown
        }
        const failure = options.loginFailure
        if (failure !== undefined || fields.password !== acceptedPassword) {
          response.writeHead(failure?.status ?? 401, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ message: failure?.html ?? '工号或密码错误' }))
          return
        }
        expect(fields.userNo).toBe(acceptedWorkcode)
        expect(fields.redirectUri).toBe(`${origin}/workbuddy-mcp/oauth2/directory-password/callback`)
        expect(fields.state).toBe('ldap-state')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: { redirectUrl: `${origin}/workbuddy-mcp/resume` } }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/workbuddy-mcp/oauth2/ldap/login') {
        const fields = new URLSearchParams(await body(request))
        if (options.loginFailure !== undefined) {
          response.writeHead(options.loginFailure.status ?? 401, { 'Content-Type': 'text/html' })
          response.end(`<div>${options.loginFailure.html}</div>`)
          return
        }
        if (fields.get('password') !== acceptedPassword) {
          response.writeHead(401, { 'Content-Type': 'text/html' })
          response.end('<div class="error">工号或密码错误</div><input placeholder="请输入裸工号">')
          return
        }
        expect(fields.get('workcode')).toBe(acceptedWorkcode)
        expect(fields.get('state')).toBe('ldap-state')
        redirect(response, '/workbuddy-mcp/resume')
        return
      }
      if (request.method === 'GET' && url.pathname === '/workbuddy-mcp/resume') {
        redirect(response, `test-app://oauth/callback?code=authorization-code&state=${oauthState}`)
        return
      }
      if (request.method === 'POST' && url.pathname === '/workbuddy-mcp/oauth2/token') {
        tokenRequests += 1
        const fields = new URLSearchParams(await body(request))
        expect(fields.get('client_id')).toBe('dsh-harness-test')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          access_token: jwt(tokenWorkcode, tokenRequests, options.tokenClaims),
          refresh_token: `refresh-${tokenRequests}`,
          expires_in: 120,
          scope: 'mcp.connect',
        }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/workbuddy-mcp/oauth2/revoke') {
        const fields = new URLSearchParams(await body(request))
        expect(fields.get('client_id')).toBe('dsh-harness-test')
        revokedTokens.push(fields.get('token') ?? '')
        response.writeHead(200)
        response.end()
        return
      }
      response.writeHead(404)
      response.end()
    })().catch((error: unknown) => {
      response.writeHead(500)
      response.end(String(error))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  cleanups.push(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => { resolve() })
    })
  })
  const address = server.address() as { port: number }
  const issuer = `http://127.0.0.1:${address.port}/workbuddy-mcp`
  return {
    client: new WorkBuddyOAuthClient({
      issuer,
      mcpURL: `${issuer}/mcp`,
      redirectURI: 'test-app://oauth/callback',
      verifyAccessToken: async (accessToken) => {
        const payload = accessToken.split('.')[1]
        return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as { workcode: string }
      },
    }),
    revokedTokens: () => [...revokedTokens],
    tokenRequests: () => tokenRequests,
  }
}

describe('WorkBuddy OAuth login', () => {
  it('uses gateway LDAP, PKCE and the signed workcode as one identity', async () => {
    const fixture = await oauthFixture({ tokenClaims: {
      name: '测试用户', department_name: '信息技术部', department_codes: ['0101', '0101', '0102'],
      job_title: '工程师', mail: 'user@example.com', mobile: '13800000000',
    } })
    const session = await fixture.client.authenticate('0104462', 'correct-password')

    expect(session).toMatchObject({
      workcode: '0104462',
      clientId: 'dsh-harness-test',
      refreshToken: 'refresh-1',
      profile: {
        providerId: 'directory-password', displayName: '测试用户', department: '信息技术部',
        departmentCodes: ['0101', '0102'], jobTitle: '工程师', email: 'user@example.com', phone: '13800000000',
      },
    })
    const refreshed = await fixture.client.refresh(session)
    expect(refreshed.workcode).toBe('0104462')
    expect(refreshed.refreshToken).toBe('refresh-2')
    expect(fixture.tokenRequests()).toBe(2)
  })

  it('revokes the refresh token without exposing it to the renderer', async () => {
    const fixture = await oauthFixture()
    const session = await fixture.client.authenticate('0104462', 'correct-password')

    await fixture.client.revoke(session)

    expect(fixture.revokedTokens()).toEqual(['refresh-1'])
  })

  it('maps a rejected gateway LDAP login without exposing the response page', async () => {
    const fixture = await oauthFixture()

    await expect(fixture.client.authenticate('0104462', 'wrong-password')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      publicMessage: '工号或密码不正确。',
    })
  })

  it('keeps compatibility with the legacy form-based password endpoint', async () => {
    const fixture = await oauthFixture({ loginProtocol: 'legacy' })

    await expect(fixture.client.authenticate('0104462', 'correct-password')).resolves.toMatchObject({
      workcode: '0104462',
    })
  })

  it('accepts a visually valid workcode containing clipboard formatting characters', async () => {
    const fixture = await oauthFixture({ workcode: '1000001' })

    await expect(fixture.client.authenticate('１０００００１\u200B', 'correct-password')).resolves.toMatchObject({
      workcode: '1000001',
    })
  })

  it('reports an invalid token identity instead of blaming the entered workcode', async () => {
    const fixture = await oauthFixture({ tokenWorkcode: 'desktop-client' })

    await expect(fixture.client.authenticate('0104462', 'correct-password')).rejects.toMatchObject({
      code: 'WORKBUDDY_TOKEN_INVALID',
    })
  })

  it.each([
    ['域控暂时不可用', 'DIRECTORY_UNREACHABLE'],
    ['域控认证失败', 'DIRECTORY_ERROR'],
    ['域控登录未正确配置', 'WORKBUDDY_UNAVAILABLE'],
  ])('does not report gateway failure %s as a wrong password', async (html, code) => {
    const fixture = await oauthFixture({ loginFailure: { html } })

    await expect(fixture.client.authenticate('0104462', 'correct-password')).rejects.toMatchObject({ code })
  })

  it('does not misreport a generic login rejection as missing MCP authorization', async () => {
    const fixture = await oauthFixture({ loginFailure: { html: 'Forbidden', status: 403 } })

    await expect(fixture.client.authenticate('0104462', 'correct-password')).rejects.toMatchObject({
      code: 'WORKBUDDY_LOGIN_REJECTED',
      publicMessage: '企业认证服务拒绝建立登录会话，请联系 IT 管理员。',
    })
  })

  it('only counts actual credential rejections toward the local retry limit', () => {
    expect(isCredentialRejection(new WorkBuddyOAuthError('INVALID_CREDENTIALS', 'rejected'))).toBe(true)
    expect(isCredentialRejection(new WorkBuddyOAuthError('DIRECTORY_ERROR', 'unavailable'))).toBe(false)
    expect(isCredentialRejection(new WorkBuddyOAuthError('WORKBUDDY_UNAVAILABLE', 'unavailable'))).toBe(false)
  })

  it('fails closed when the token workcode differs from the entered workcode', async () => {
    const fixture = await oauthFixture({ tokenWorkcode: '1000001' })

    await expect(fixture.client.authenticate('0104462', 'correct-password')).rejects.toMatchObject({
      code: 'WORKBUDDY_IDENTITY_MISMATCH',
    })
  })

  it('rejects a non-numeric account before contacting the gateway', async () => {
    const client = new WorkBuddyOAuthClient()
    await expect(client.authenticate('user@example.com', 'password')).rejects.toBeInstanceOf(WorkBuddyOAuthError)
  })
})

describe('WorkBuddy token broker', () => {
  it('keeps tokens in the Electron process and refreshes them for the MCP plugin', async () => {
    const initial: WorkBuddyOAuthSession = {
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1,
      workcode: '0104462',
      profile: { providerId: 'ldap', departmentCodes: [] },
      clientId: 'dsh-harness-test',
      scope: 'mcp.connect',
    }
    const refreshedExpiresAt = Date.now() + 120_000
    const refresh = vi.fn(async (): Promise<WorkBuddyOAuthSession> => ({
      ...initial,
      accessToken: 'fresh-token',
      expiresAt: refreshedExpiresAt,
    }))
    const revoke = vi.fn(async (_session: WorkBuddyOAuthSession): Promise<void> => {})
    const broker = await startWorkBuddyTokenBroker({ refresh, revoke } as unknown as WorkBuddyOAuthClient, initial)
    cleanups.push(broker.close)

    const rejected = await fetch(broker.url, { method: 'POST' })
    expect(rejected.status).toBe(404)
    const response = await fetch(broker.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.secret}` },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      accessToken: 'fresh-token',
      workcode: '0104462',
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(broker.account()).toMatchObject({
      workcode: '0104462',
      expiresAt: refreshedExpiresAt,
    })
    await broker.revoke()
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-token' }))
  })

  it('serves personal memory through the authenticated broker and binds writes to the login workcode', async () => {
    const initial: WorkBuddyOAuthSession = {
      accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 120_000,
      workcode: '1000001', profile: { providerId: 'ldap', departmentCodes: [] }, clientId: 'desktop', scope: 'mcp.connect',
    }
    const read = vi.fn().mockResolvedValue({ enabled: true, entries: [] })
    const query = vi.fn().mockResolvedValue([])
    const capture = vi.fn().mockResolvedValue({ enabled: true, entries: [] })
    const store = { read, query, capture } as unknown as PersonalMemoryStore
    const broker = await startWorkBuddyTokenBroker({ refresh: vi.fn() } as unknown as WorkBuddyOAuthClient, initial, store)
    cleanups.push(broker.close)
    const endpoint = new URL('/memory/state', broker.url)

    await expect(fetch(endpoint)).resolves.toMatchObject({ status: 404 })
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${broker.secret}` } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ enabled: true, entries: [] })
    expect(read).toHaveBeenCalledWith('1000001')

    const workspaceKey = 'a'.repeat(32)
    const queried = await fetch(new URL('/memory/query', broker.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '项目约定', workspaceKey, limit: 5, workcode: '0104462' }),
    })
    expect(queried.status).toBe(200)
    expect(query).toHaveBeenCalledWith('1000001', '项目约定', workspaceKey, 5)

    const candidate = {
      kind: 'CONTEXT', text: '我们的项目使用 pnpm', scope: 'WORKSPACE', workspaceKey,
      sourceSessionId: 'session-1', sourceEventSeq: 3,
    }
    const captured = await fetch(new URL('/memory/capture', broker.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: [candidate], workcode: '0104462' }),
    })
    expect(captured.status).toBe(200)
    expect(capture).toHaveBeenCalledWith('1000001', [{
      kind: candidate.kind,
      summary: candidate.text,
      scope: candidate.scope,
      workspaceKey,
      sourceSessionId: candidate.sourceSessionId,
      sourceEventSeq: candidate.sourceEventSeq,
    }])
  })

  it('gates every WeCom Tool call with the Harness-owned device lease', async () => {
    const initial: WorkBuddyOAuthSession = {
      accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 120_000,
      workcode: '1000001', profile: { providerId: 'ldap', departmentCodes: [] }, clientId: 'desktop', scope: 'mcp.connect',
    }
    const authorizationForTool = vi.fn()
      .mockResolvedValueOnce({ expiresAt: Date.now() + 60_000, writeExpiresAt: Date.now() + 30_000 })
      .mockResolvedValueOnce(undefined)
    const broker = await startWorkBuddyTokenBroker(
      { refresh: vi.fn() } as unknown as WorkBuddyOAuthClient,
      initial,
      undefined,
      { authorizationForTool },
    )
    cleanups.push(broker.close)

    const readURL = new URL('/wecom/session', broker.url)
    const allowed = await fetch(readURL, {
      method: 'POST', headers: { Authorization: `Bearer ${broker.secret}` },
    })
    expect(allowed.status).toBe(200)
    expect(authorizationForTool).toHaveBeenNthCalledWith(1, false)

    const writeURL = new URL('/wecom/session?write=1', broker.url)
    const denied = await fetch(writeURL, {
      method: 'POST', headers: { Authorization: `Bearer ${broker.secret}` },
    })
    expect(denied.status).toBe(401)
    expect(authorizationForTool).toHaveBeenNthCalledWith(2, true)
  })
})
