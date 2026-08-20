import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as ManagedGateway from '@deepseek-ai/dsh-llm-openai-compatible-managed'

const servers: Server[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })))
  vi.unstubAllEnvs()
})

async function listingServer(models: unknown[]): Promise<{ url: string; authorization: string[] }> {
  const authorization: string[] = []
  const server = createServer((request, response) => {
    authorization.push(request.headers.authorization ?? '')
    if (request.url !== '/v1/models') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: models }))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not bind')
  return { url: `http://127.0.0.1:${address.port}/v1`, authorization }
}

async function boot(baseURL: string, credentialValue?: string): Promise<Context> {
  vi.stubEnv('MODEL_GATEWAY_API_KEY', 'managed-key')
  vi.stubEnv('MODEL_GATEWAY_BASE_URL', baseURL)
  const ctx = new Context()
  contexts.push(ctx)
  if (credentialValue !== undefined) {
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: credentialValue, source: 'test' }),
    } as never)
  }
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ManagedGateway, {
    provider: 'managed',
    displayName: 'Managed Model Gateway',
    baseURLEnv: 'MODEL_GATEWAY_BASE_URL',
    apiKeyEnv: 'MODEL_GATEWAY_API_KEY',
  })
  return ctx
}

describe('managed OpenAI-compatible gateway catalog', () => {
  it('registers only models returned by the gateway and exposes no editable directory', async () => {
    const server = await listingServer([
      { id: 'deepseek-v4-flash', display_name: 'DeepSeek V4 Flash' },
      { id: 'glm-5.2' },
    ])
    const ctx = await boot(server.url)

    expect(ctx.llm.listProviders()).toEqual([{ id: 'managed', name: 'Managed Model Gateway' }])
    await expect(ctx.llm.listModels('managed')).resolves.toMatchObject([
      { provider: 'managed', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { provider: 'managed', id: 'glm-5.2', name: 'glm-5.2' },
    ])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    await expect(ctx.llm.resolveModelInfo('managed', 'hand-written-model')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    expect(server.authorization).toEqual(['Bearer managed-key'])
  })

  it('fails startup when the gateway returns duplicate model ids', async () => {
    const server = await listingServer([{ id: 'same' }, { id: 'same' }])
    await expect(boot(server.url)).rejects.toThrow(/duplicate model id "same"/)
  })

  it('uses an optional credentials service without direct-inject access', async () => {
    const server = await listingServer([{ id: 'managed-model' }])

    await expect(boot(server.url, 'service-key')).resolves.toBeInstanceOf(Context)
    expect(server.authorization).toEqual(['Bearer service-key'])
  })
})
