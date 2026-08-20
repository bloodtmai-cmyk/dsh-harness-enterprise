import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createBearerTokenBrokerFetch } from '@deepseek-ai/dsh-mcp-client/src/transport.ts'
import type { StreamableHttpConfig } from '@deepseek-ai/dsh-mcp-client'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
  })))
})

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address() as { port: number }
  return `http://127.0.0.1:${address.port}`
}

describe('MCP Bearer token broker', () => {
  it('injects the broker token and retries one 401 with a forced refresh', async () => {
    const brokerCalls: string[] = []
    const brokerBase = await listen(createServer((request, response) => {
      brokerCalls.push(request.url ?? '')
      const accessToken = request.url?.includes('force=1') === true ? 'second-token' : 'first-token'
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ accessToken }))
    }))
    const targetTokens: string[] = []
    const targetBase = await listen(createServer((request, response) => {
      targetTokens.push(request.headers.authorization ?? '')
      if (request.headers.authorization === 'Bearer first-token') {
        response.writeHead(401)
        response.end()
        return
      }
      response.writeHead(200)
      response.end('ok')
    }))
    const config: StreamableHttpConfig = {
      transport: 'streamable-http',
      serverName: 'workbuddy',
      url: `${targetBase}/mcp`,
      headers: {},
      bearerTokenBroker: {
        url: `${brokerBase}/token`,
        secret: 'a'.repeat(32),
      },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: true,
    }

    const response = await createBearerTokenBrokerFetch(config)(`${targetBase}/mcp`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(brokerCalls).toEqual(['/token', '/token?force=1'])
    expect(targetTokens).toEqual(['Bearer first-token', 'Bearer second-token'])
  })

  it.each([
    'https://example.com/token',
    'http://127.0.0.1/token',
    'http://user@127.0.0.1:1234/token',
    'http://127.0.0.1:1234/token?shared=1',
  ])('rejects a broker outside the exact loopback endpoint: %s', (brokerURL) => {
    const config: StreamableHttpConfig = {
      transport: 'streamable-http',
      serverName: 'workbuddy',
      url: 'https://example.com/mcp',
      headers: {},
      bearerTokenBroker: {
        url: brokerURL,
        secret: 'a'.repeat(32),
      },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: true,
    }

    expect(() => createBearerTokenBrokerFetch(config)).toThrow(/127\.0\.0\.1/)
  })
})
