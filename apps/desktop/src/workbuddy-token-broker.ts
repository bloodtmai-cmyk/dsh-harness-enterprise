import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type {
  WorkBuddyEnterpriseProfile,
  WorkBuddyOAuthClient,
  WorkBuddyOAuthSession,
} from './workbuddy-oauth.ts'
import type { PersonalMemoryKind, PersonalMemoryScope, PersonalMemoryStore } from './personal-memory-store.ts'

const REFRESH_WINDOW_MS = 60_000
const FORCE_REFRESH_DEDUP_MS = 5_000

export interface WorkBuddyTokenBroker {
  url: string
  secret: string
  account: () => WorkBuddyAccountSnapshot
  revoke: () => Promise<void>
  close: () => Promise<void>
}

export interface WorkBuddyAccountSnapshot {
  workcode: string
  profile: WorkBuddyEnterpriseProfile
  expiresAt: number
}

export interface WeComAuthorizationGate {
  authorizationForTool(write: boolean): Promise<{ expiresAt: number; writeExpiresAt: number } | undefined>
}

function matchesSecret(actual: string | undefined, expected: string): boolean {
  const prefix = 'Bearer '
  if (actual?.startsWith(prefix) !== true) return false
  const received = Buffer.from(actual.slice(prefix.length))
  const wanted = Buffer.from(expected)
  return received.length === wanted.length && timingSafeEqual(received, wanted)
}

export async function startWorkBuddyTokenBroker(
  oauthClient: WorkBuddyOAuthClient,
  initialSession: WorkBuddyOAuthSession,
  personalMemory?: PersonalMemoryStore,
  weComAuthorization?: WeComAuthorizationGate,
): Promise<WorkBuddyTokenBroker> {
  let session = initialSession
  let refreshInFlight: Promise<void> | undefined
  let lastRefreshAt = 0
  const secret = randomBytes(32).toString('base64url')

  const refresh = async (force: boolean): Promise<void> => {
    const now = Date.now()
    const shouldRefresh = session.expiresAt - now <= REFRESH_WINDOW_MS
      || (force && now - lastRefreshAt > FORCE_REFRESH_DEDUP_MS)
    if (!shouldRefresh) return
    if (refreshInFlight === undefined) {
      refreshInFlight = oauthClient.refresh(session).then((next) => {
        session = next
        lastRefreshAt = Date.now()
      }).finally(() => {
        refreshInFlight = undefined
      })
    }
    await refreshInFlight
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const requestURL = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!matchesSecret(request.headers.authorization, secret)) {
        response.writeHead(404, { 'Cache-Control': 'no-store' })
        response.end()
        return
      }
      if (requestURL.pathname.startsWith('/memory/')) {
        if (personalMemory === undefined) {
          sendJson(response, 503, { error: 'personal memory is unavailable' })
          return
        }
        await handlePersonalMemoryRequest(
          request,
          response,
          requestURL,
          personalMemory,
          initialSession.workcode,
        )
        return
      }
      if (request.method === 'POST' && requestURL.pathname === '/wecom/session') {
        if (weComAuthorization === undefined) {
          sendJson(response, 503, { error: 'WeCom authorization is unavailable' })
          return
        }
        const write = requestURL.searchParams.get('write') === '1'
        const lease = await weComAuthorization.authorizationForTool(write)
        if (lease === undefined) {
          sendJson(response, 401, {
            error: write
              ? 'WeCom write operation requires a fresh QR authorization'
              : 'WeCom QR authorization is required',
          })
          return
        }
        sendJson(response, 200, {
          authorized: true,
          expiresAt: lease.expiresAt,
          writeExpiresAt: lease.writeExpiresAt,
        })
        return
      }
      if (request.method !== 'POST' || requestURL.pathname !== '/token') {
        response.writeHead(404, { 'Cache-Control': 'no-store' })
        response.end()
        return
      }
      await refresh(requestURL.searchParams.get('force') === '1')
      sendJson(response, 200, {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        workcode: session.workcode,
      })
    })().catch(() => {
      if (!response.headersSent) response.writeHead(503, { 'Cache-Control': 'no-store' })
      response.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => {
      server.close(() => { resolve() })
    })
    throw new Error('无法启动 MCP 本地凭据代理')
  }
  server.unref()
  return {
    url: `http://127.0.0.1:${address.port}/token`,
    secret,
    account: () => ({
      workcode: session.workcode,
      profile: { ...session.profile, departmentCodes: [...session.profile.departmentCodes] },
      expiresAt: session.expiresAt,
    }),
    revoke: async () => { await oauthClient.revoke(session) },
    close: async () => {
      if (!server.listening) return
      await new Promise<void>((resolve) => {
        server.close(() => { resolve() })
      })
    },
  }
}

async function handlePersonalMemoryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestURL: URL,
  store: PersonalMemoryStore,
  workcode: string,
): Promise<void> {
  if (request.method === 'GET' && requestURL.pathname === '/memory/state') {
    sendJson(response, 200, await store.read(workcode))
    return
  }
  if (request.method === 'POST' && requestURL.pathname === '/memory/query') {
    const body = await readJsonBody(request)
    const query = typeof body.query === 'string' ? body.query : ''
    const workspaceKey = body.workspaceKey === undefined ? undefined : stringField(body.workspaceKey)
    const limit = typeof body.limit === 'number' ? body.limit : 20
    sendJson(response, 200, { entries: await store.query(workcode, query, workspaceKey, limit) })
    return
  }
  if (request.method === 'POST' && requestURL.pathname === '/memory/capture') {
    const body = await readJsonBody(request)
    const values = Array.isArray(body.candidates) ? body.candidates : []
    const candidates = values.map((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid memory candidate')
      const candidate = value as Record<string, unknown>
      const summary = candidate.summary ?? candidate.text
      return {
        kind: memoryKind(candidate.kind),
        ...(candidate.title === undefined ? {} : { title: stringField(candidate.title) }),
        summary: stringField(summary),
        scope: memoryScope(candidate.scope),
        ...(candidate.workspaceKey === undefined ? {} : { workspaceKey: stringField(candidate.workspaceKey) }),
        sourceSessionId: stringField(candidate.sourceSessionId),
        sourceEventSeq: numberField(candidate.sourceEventSeq),
      }
    })
    sendJson(response, 200, await store.capture(workcode, candidates))
    return
  }
  response.writeHead(404, { 'Cache-Control': 'no-store' })
  response.end()
}

function memoryKind(value: unknown): PersonalMemoryKind {
  if (value === 'PREFERENCE' || value === 'FACT' || value === 'CONTEXT' || value === 'JOURNAL') return value
  throw new Error('invalid personal memory kind')
}

function memoryScope(value: unknown): PersonalMemoryScope {
  if (value === 'GLOBAL' || value === 'WORKSPACE') return value
  throw new Error('invalid personal memory scope')
}

function stringField(value: unknown): string {
  if (typeof value !== 'string') throw new Error('personal memory request field must be a string')
  return value
}

function numberField(value: unknown): number {
  if (typeof value !== 'number') throw new Error('personal memory request field must be a number')
  return value
}

async function readJsonBody(request: AsyncIterable<unknown>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))
    bytes += chunk.length
    if (bytes > 64 * 1024) throw new Error('personal memory request is too large')
    chunks.push(chunk)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('personal memory request must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function sendJson(
  response: { writeHead(status: number, headers: Record<string, string | number>): void; end(body?: string): void },
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}
