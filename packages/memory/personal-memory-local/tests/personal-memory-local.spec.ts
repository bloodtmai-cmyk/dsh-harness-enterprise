import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, extractMemoryCandidates, shouldRecallMemory } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function requestURL(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON string request body')
  return JSON.parse(init.body) as unknown
}

describe('personal-memory-local', () => {
  const config = {
    tokenBrokerURL: 'http://127.0.0.1:39001/token', tokenBrokerSecret: 'secret',
    maxPromptEntries: 8, maxPromptChars: 2_000, snapshotRefreshMs: 5_000, maxQueryResults: 5,
    autoJournalMinChars: 80,
  }

  it('injects a small global capsule and recalls relevant scoped memory on the first step', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = requestURL(input)
      if (url.endsWith('/memory/state')) {
        return Response.json({
          enabled: true,
          entries: [
            { id: 'm1', kind: 'PREFERENCE', title: '回答风格', summary: '使用简洁中文', scope: 'GLOBAL', source: 'LOCAL_CONVERSATION', createdAt: 't1', updatedAt: 't1' },
            { id: 'm2', kind: 'CONTEXT', title: '包管理器', summary: '我们的项目使用 pnpm', scope: 'WORKSPACE', source: 'LOCAL_CONVERSATION', workspaceKey: 'a'.repeat(32), createdAt: 't2', updatedAt: 't2' },
          ],
        })
      }
      return Response.json({
        entries: [{ id: 'm2', kind: 'CONTEXT', title: '包管理器', summary: '我们的项目使用 pnpm', scope: 'WORKSPACE', source: 'LOCAL_CONVERSATION', workspaceKey: 'a'.repeat(32), createdAt: 't2', updatedAt: 't2' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    let section: { text: () => string } | undefined
    const listeners = new Map<string, (...args: never[]) => unknown>()
    let cleanup = (): void => {}
    const ctx = {
      systemPrompt: { section: vi.fn((value: { text: () => string }) => { section = value }) },
      effect: vi.fn((install: () => undefined | (() => void)) => {
        const installed = install()
        if (typeof installed === 'function') cleanup = installed
        return vi.fn()
      }),
      on: vi.fn((name: string, listener: (...args: never[]) => unknown) => { listeners.set(name, listener); return vi.fn() }),
    } as unknown as Context

    await apply(ctx, config)
    expect(section?.text()).toContain('[PREFERENCE] 回答风格: 使用简洁中文')
    expect(section?.text()).not.toContain('我们的项目使用 pnpm')
    const preStep = listeners.get('agent/pre-step') as unknown as (
      payload: Record<string, unknown>,
      next: () => Promise<{ kind: 'enter'; messages: ReturnType<typeof createUserMessage>[] }>,
    ) => Promise<{ kind: string; messages: ReturnType<typeof createUserMessage>[] }>
    const older = createUserMessage({ content: [{ type: 'text', text: '上一轮无关问题' }], source: { kind: 'user' } })
    const human = createUserMessage({ content: [{ type: 'text', text: '这个项目用什么包管理器？' }], source: { kind: 'user' } })
    const result = await preStep({
      agent: { session: { header: { cwd: '/workspace/example' } } },
      messages: [older, human],
      signal: AbortSignal.timeout(1_000),
      step: 1,
    }, async () => ({ kind: 'enter', messages: [older, human] }))
    expect(result.messages.at(-1)?.source).toMatchObject({ kind: 'plugin', plugin: 'personal-memory-local', form: 'recall' })
    const recalledText = result.messages.at(-1)?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(recalledText).toContain('我们的项目使用 pnpm')
    const queryRequest = fetchMock.mock.calls.find(([input]) => requestURL(input).endsWith('/memory/query'))
    expect(queryRequest?.[1]?.method).toBe('POST')
    expect(new Headers(queryRequest?.[1]?.headers).get('Authorization')).toBe('Bearer secret')
    expect(requestBody(queryRequest?.[1])).toMatchObject({ query: '这个项目用什么包管理器？', limit: 5 })
    cleanup()
  })

  it('captures only direct human messages after the matching turn ends', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestURL(input)
      if (url.endsWith('/memory/state')) return Response.json({ enabled: true, entries: [] })
      if (url.endsWith('/memory/capture')) {
        const request = requestBody(init) as { candidates: unknown[] }
        return Response.json({ enabled: true, entries: request.candidates })
      }
      return Response.json({ entries: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const ctx = {
      systemPrompt: { section: vi.fn() },
      effect: vi.fn((install: () => undefined | (() => void)) => { install(); return vi.fn() }),
      on: vi.fn((name: string, listener: (...args: never[]) => unknown) => { listeners.set(name, listener); return vi.fn() }),
    } as unknown as Context
    await apply(ctx, config)

    const onEvent = listeners.get('session/event') as unknown as (session: unknown, event: unknown) => void
    const session = { id: 'session-1', header: { cwd: '/workspace/example' } }
    onEvent(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    onEvent(session, {
      type: 'user/message', seq: 2,
      data: { source: { kind: 'plugin', plugin: 'test' }, content: [{ type: 'text', text: '记住：不要采集插件消息' }] },
    })
    onEvent(session, {
      type: 'user/message', seq: 3,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '以后默认使用简洁中文。我们的项目使用 pnpm。' }] },
    })
    onEvent(session, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } })

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => requestURL(input).endsWith('/memory/capture'))).toBe(true)
    })
    const capture = fetchMock.mock.calls.find(([input]) => requestURL(input).endsWith('/memory/capture'))
    const body = requestBody(capture?.[1]) as { candidates: Array<Record<string, unknown>> }
    expect(body.candidates).toHaveLength(2)
    expect(body.candidates[0]).toMatchObject({
      kind: 'PREFERENCE', summary: '默认使用简洁中文。', scope: 'GLOBAL',
      sourceSessionId: 'session-1', sourceEventSeq: 3,
    })
    expect(body.candidates[1]).toMatchObject({
      kind: 'CONTEXT', summary: '我们的项目使用 pnpm。', scope: 'WORKSPACE',
      sourceSessionId: 'session-1', sourceEventSeq: 3,
    })
    expect(body.candidates[1]?.workspaceKey).toMatch(/^[a-f0-9]{32}$/)
    expect(JSON.stringify(body)).not.toContain('不要采集插件消息')
  })

  it('creates one bounded workspace journal from a substantial completed turn without a second model call', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestURL(input)
      if (url.endsWith('/memory/state')) return Response.json({ enabled: true, entries: [] })
      if (url.endsWith('/memory/capture')) {
        const request = requestBody(init) as { candidates: unknown[] }
        return Response.json({ enabled: true, entries: request.candidates })
      }
      return Response.json({ entries: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const ctx = {
      systemPrompt: { section: vi.fn() },
      effect: vi.fn((install: () => undefined | (() => void)) => { install(); return vi.fn() }),
      on: vi.fn((name: string, listener: (...args: never[]) => unknown) => { listeners.set(name, listener); return vi.fn() }),
    } as unknown as Context
    await apply(ctx, config)

    const onEvent = listeners.get('session/event') as unknown as (session: unknown, event: unknown) => void
    const session = { id: 'session-journal', header: { cwd: '/workspace/example' } }
    const request = `请梳理库存差异并给出修复方案。${'需要保留可复核的业务步骤。'.repeat(12)}`
    const answer = `已经完成核对，确认差异来自重复聚合，并给出了最小修复和验证结果。${'后续按真实数据复验。'.repeat(12)}`
    onEvent(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    onEvent(session, { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: request }] } })
    onEvent(session, {
      type: 'assistant/message', seq: 3,
      data: { turn: 1, step: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: answer }] } },
    })
    onEvent(session, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } })

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => requestURL(input).endsWith('/memory/capture'))).toBe(true)
    })
    const capture = fetchMock.mock.calls.find(([input]) => requestURL(input).endsWith('/memory/capture'))
    const body = requestBody(capture?.[1]) as { candidates: Array<Record<string, unknown>> }
    expect(body.candidates).toHaveLength(1)
    expect(body.candidates[0]).toMatchObject({
      kind: 'JOURNAL', scope: 'WORKSPACE', sourceSessionId: 'session-journal', sourceEventSeq: 4,
    })
    expect(body.candidates[0]?.workspaceKey).toMatch(/^[a-f0-9]{32}$/)
    expect(body.candidates[0]?.summary).toContain('目标：请梳理库存差异')
    expect(body.candidates[0]?.summary).toContain('结论：已经完成核对')
    expect(String(body.candidates[0]?.summary).length).toBeLessThanOrEqual(320)
  })

  it('does not journal interrupted turns', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ enabled: true, entries: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const ctx = {
      systemPrompt: { section: vi.fn() },
      effect: vi.fn((install: () => undefined | (() => void)) => { install(); return vi.fn() }),
      on: vi.fn((name: string, listener: (...args: never[]) => unknown) => { listeners.set(name, listener); return vi.fn() }),
    } as unknown as Context
    await apply(ctx, config)
    const onEvent = listeners.get('session/event') as unknown as (session: unknown, event: unknown) => void
    const session = { id: 'session-interrupted', header: { cwd: '/workspace/example' } }
    onEvent(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    onEvent(session, { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记住：以后默认使用中文。'.repeat(20) }] } })
    onEvent(session, {
      type: 'assistant/message', seq: 3,
      data: { turn: 1, step: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '处理中'.repeat(100) }] } },
    })
    onEvent(session, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'interrupted' } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetchMock.mock.calls.some(([input]) => requestURL(input).endsWith('/memory/capture'))).toBe(false)
  })

  it('does not journal a completed turn without an explicit result', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ enabled: true, entries: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const listeners = new Map<string, (...args: never[]) => unknown>()
    const ctx = {
      systemPrompt: { section: vi.fn() },
      effect: vi.fn((install: () => undefined | (() => void)) => { install(); return vi.fn() }),
      on: vi.fn((name: string, listener: (...args: never[]) => unknown) => { listeners.set(name, listener); return vi.fn() }),
    } as unknown as Context
    await apply(ctx, config)
    const onEvent = listeners.get('session/event') as unknown as (session: unknown, event: unknown) => void
    const session = { id: 'session-no-result', header: { cwd: '/workspace/example' } }
    onEvent(session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
    onEvent(session, { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看一下这些库存数据并给出思路。'.repeat(5) }] } })
    onEvent(session, {
      type: 'assistant/message', seq: 3,
      data: { turn: 1, step: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '可以从仓库、库龄和周转率三个方向继续检查。'.repeat(5) }] } },
    })
    onEvent(session, { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetchMock.mock.calls.some(([input]) => requestURL(input).endsWith('/memory/capture'))).toBe(false)
  })

  it('uses conservative deterministic extraction and rejects secret or transient statements', () => {
    expect(extractMemoryCandidates('记住：以后默认使用中文。')).toEqual([{ kind: 'PREFERENCE', title: '以后默认使用中文', summary: '以后默认使用中文。' }])
    expect(extractMemoryCandidates('我的名字是小王。')).toEqual([{ kind: 'FACT', title: '我的名字是小王', summary: '我的名字是小王。' }])
    expect(extractMemoryCandidates('我的 API key: sk-abcdefghijklmnopqrstuvwxyz123456')).toEqual([])
    expect(extractMemoryCandidates('明天临时使用英文。')).toEqual([])
    expect(extractMemoryCandidates('你能记住我的偏好吗？')).toEqual([])
  })

  it('gates recall for acknowledgements and continuation-only messages', () => {
    expect(shouldRecallMemory('好的，继续')).toBe(false)
    expect(shouldRecallMemory('谢谢')).toBe(false)
    expect(shouldRecallMemory('这个项目之前决定用什么包管理器？')).toBe(true)
    expect(shouldRecallMemory('按我之前的回答偏好来')).toBe(true)
  })
})
