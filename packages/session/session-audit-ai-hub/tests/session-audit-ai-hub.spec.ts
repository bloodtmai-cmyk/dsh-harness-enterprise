import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiHubAuditReporter } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI Hub conversation audit', () => {
  it('uploads a completed turn and refreshes the WorkBuddy token after 401', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let hubAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(init === undefined ? { url } : { url, init })
      if (url.startsWith('http://127.0.0.1:39001/token')) {
        return Response.json({ accessToken: url.includes('force=1') ? 'token-refreshed' : 'token-initial' })
      }
      hubAttempts += 1
      return hubAttempts === 1 ? new Response('', { status: 401 }) : new Response(null, { status: 204 })
    }))

    const logger = { error: vi.fn() }
    const reporter = new AiHubAuditReporter({ logger } as unknown as Context, {
      hubBaseURL: 'https://hub.example/ai-hub',
      tokenBrokerURL: 'http://127.0.0.1:39001/token',
      tokenBrokerSecret: 'broker-secret',
      installationId: 'installation-1',
      defaultModel: 'fallback-model',
    })

    for (const event of oneTurnEvents()) reporter.observe('session-1', event)
    await reporter.close()

    expect(calls.map(call => call.url)).toEqual([
      'http://127.0.0.1:39001/token',
      'https://hub.example/ai-hub/api/client/conversation-audits',
      'http://127.0.0.1:39001/token?force=1',
      'https://hub.example/ai-hub/api/client/conversation-audits',
    ])
    expect(calls[0]?.init?.headers).toEqual({ Authorization: 'Bearer broker-secret' })
    expect(calls[3]?.init?.headers).toMatchObject({ Authorization: 'Bearer token-refreshed' })
    const body = calls[3]?.init?.body
    expect(typeof body).toBe('string')
    expect(JSON.parse(typeof body === 'string' ? body : '')).toMatchObject({
      sessionId: 'session-1',
      turnId: '1',
      clientInstallationId: 'installation-1',
      model: 'deepseek-chat',
      userMessage: '检查库存',
      assistantMessage: '库存正常',
      inputTokens: 12,
      outputTokens: 5,
      latencyMs: 1200,
      status: 'SUCCESS',
    })
    expect(logger.error).not.toHaveBeenCalled()
  })
})

function oneTurnEvents(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1_000, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 1_050, surfaceOp: 'append',
      data: {
        id: 'user-1', role: 'user', content: [{ type: 'text', text: '检查库存' }], source: { kind: 'user' },
      },
    },
    {
      type: 'assistant/message', seq: 2, time: 2_000, surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: '库存正常' }],
          source: { kind: 'model', provider: 'litellm', model: 'deepseek-chat' },
        },
        usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 0, reasoningTokens: 0 },
      },
    },
    { type: 'turn/end', seq: 3, time: 2_200, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as unknown as SessionEvent[]
}
