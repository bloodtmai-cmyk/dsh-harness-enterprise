/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config, StreamableHttpConfig } from './index.ts'

interface BrokerTokenResponse {
  accessToken?: unknown
}

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

function validateBroker(config: NonNullable<StreamableHttpConfig['bearerTokenBroker']>): URL {
  const url = new URL(config.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port.length === 0
    || url.username.length > 0 || url.password.length > 0 || url.pathname !== '/token'
    || url.search.length > 0 || url.hash.length > 0) {
    throw new Error('mcp-client bearerTokenBroker must use http://127.0.0.1:<port>/token')
  }
  if (config.secret.length < 32) throw new Error('mcp-client bearerTokenBroker secret is too short')
  return url
}

/**
 * Create a fetch wrapper that obtains short-lived bearer tokens from Electron.
 * @param config - Streamable HTTP config containing the authenticated loopback broker.
 * @returns Fetch-compatible sender that refreshes once after an HTTP 401 response.
 */
export function createBearerTokenBrokerFetch(config: StreamableHttpConfig): FetchLike {
  const broker = config.bearerTokenBroker
  if (broker === undefined) throw new Error('mcp-client bearerTokenBroker is missing')
  const brokerURL = validateBroker(broker)

  const token = async (force: boolean): Promise<string> => {
    const url = new URL(brokerURL)
    if (force) url.searchParams.set('force', '1')
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.secret}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json() as BrokerTokenResponse
    if (!response.ok || typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
      throw new Error(`mcp-client token broker failed: HTTP ${response.status}`)
    }
    return body.accessToken
  }

  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const send = async (force: boolean): Promise<Response> => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${await token(force)}`)
      return await fetch(url, { ...init, headers })
    }
    const response = await send(false)
    if (response.status !== 401) return response
    await response.body?.cancel()
    return await send(true)
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(new URL(config.url), config.bearerTokenBroker === undefined
        ? { requestInit: { headers: config.headers } }
        : { requestInit: { headers: config.headers }, fetch: createBearerTokenBrokerFetch(config) }) as Transport
  }
}
