import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop, { AGENT_LOOP_CIRCUIT_OPEN_CODE, type Config } from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmError, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, config: Omit<Config, 'agents'>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { ...config, agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function turnReasons(agent: Agent) {
  return agent.session.events.flatMap(event => event.type === 'turn/end' ? [event.data.reason] : [])
}

function registerEcho(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'echo back',
    parameters: { text: { type: 'string' } },
    async execute(args) {
      return [{ type: 'text', text: `echo: ${args.text}` }]
    },
  }))
}

function fail(message: string, code: string): () => never {
  return () => { throw new LlmError(message, code) }
}

describe('agent-loop circuit breaker', () => {
  it.each([
    ['maxStepsPerTurn', 0],
    ['maxRequestAttemptsPerStep', 1.5],
    ['maxTokensPerTurn', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects invalid deployment limit %s=%s during direct construction', (name, value) => {
    expect(() => new AgentLoop(new Context(), { agents: [], [name]: value }))
      .toThrow(`${name} must be a positive safe integer`)
  })

  it('stops a successful tool-call loop before the next over-budget step', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'one' }),
      toolCallResponse('c2', 'echo', { text: 'two' }),
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter, { maxStepsPerTurn: 2 })
    registerEcho(ctx)
    const agent = ctx.agentLoop.create(SessionId('step-circuit'), { provider: 'mock', model: 'mock' })

    send(agent, 'keep calling')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(event => event.type === 'tool/result')).toHaveLength(2)
    expect(turnReasons(agent)).toHaveLength(1)
    expect(turnReasons(agent)[0]).toMatchObject({
      kind: 'error',
      error: { code: AGENT_LOOP_CIRCUIT_OPEN_CODE },
    })
  })

  it('stops retry middleware that keeps reopening the same failed request', async () => {
    const adapter = new MockAdapter([
      fail('busy', 'RATE_LIMIT'),
      fail('still busy', 'RATE_LIMIT'),
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter, { maxRequestAttemptsPerStep: 2 })
    const agent = ctx.agentLoop.create(SessionId('retry-circuit'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async () => ({ kind: 'retry' }))

    send(agent, 'retry forever')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(turnReasons(agent)[0]).toMatchObject({
      kind: 'error',
      error: { code: AGENT_LOOP_CIRCUIT_OPEN_CODE },
    })
  })

  it('counts reported input, output, and cache usage before another request', async () => {
    const response = toolCallResponse('c1', 'echo', { text: 'one' })
    const usage = response.find(chunk => chunk.type === 'usage')
    if (usage?.type !== 'usage') throw new Error('fixture has no usage chunk')
    usage.usage = { inputTokens: 5, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 2 }
    const adapter = new MockAdapter([response, textResponse('must not run')])
    const ctx = await harness(adapter, { maxTokensPerTurn: 17 })
    registerEcho(ctx)
    const agent = ctx.agentLoop.create(SessionId('token-circuit'), { provider: 'mock', model: 'mock' })

    send(agent, 'spend tokens')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(turnReasons(agent)[0]).toMatchObject({
      kind: 'error',
      error: { code: AGENT_LOOP_CIRCUIT_OPEN_CODE },
    })
  })

  it('gives the next user turn a fresh circuit-breaker budget', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'one' }),
      textResponse('recovered'),
    ])
    const ctx = await harness(adapter, { maxStepsPerTurn: 1 })
    registerEcho(ctx)
    const agent = ctx.agentLoop.create(SessionId('turn-reset'), { provider: 'mock', model: 'mock' })

    send(agent, 'first turn loops')
    await agent.whenIdle()
    send(agent, 'second turn is bounded independently')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(turnReasons(agent).map(reason => reason.kind)).toEqual(['error', 'completed'])
  })
})
