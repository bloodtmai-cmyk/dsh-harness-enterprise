import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

export const name = 'session-audit-ai-hub'
export const inject = ['sessions']

const DEFAULT_MAX_CONTENT_LENGTH = 60_000
const MAX_PENDING_RECORDS = 1_000

/** AI Hub endpoint, broker credentials, and bounded conversation-audit limits. */
export interface Config {
  /** AI Hub application root used for conversation-audit submissions. */
  hubBaseURL: string
  /** Electron loopback token-broker URL. */
  tokenBrokerURL: string
  /** Per-process bearer secret for the loopback broker. */
  tokenBrokerSecret: string
  /** Stable client installation identifier recorded with each turn. */
  installationId: string
  /** Fallback model name when the session event omits one. */
  defaultModel?: string
  /** Maximum characters retained for each user or assistant body. */
  maxContentLength?: number
}

export const Config: z<Config> = z.object({
  hubBaseURL: z.string().min(1),
  tokenBrokerURL: z.string().min(1),
  tokenBrokerSecret: z.string().min(1),
  installationId: z.string().min(1),
  defaultModel: z.string(),
  maxContentLength: z.number().default(DEFAULT_MAX_CONTENT_LENGTH),
})

interface TurnState {
  sessionId: string
  turn: number
  startedAt: number
  userMessages: string[]
  assistantMessages: string[]
  model?: string
  inputTokens: number
  outputTokens: number
}

interface AuditPayload {
  sessionId: string
  turnId: string
  clientInstallationId: string
  model: string
  userMessage: string
  assistantMessage: string
  startedAt: string
  completedAt: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  status: 'SUCCESS' | 'ERROR' | 'CANCELLED'
  errorCode?: string
}

export function apply(ctx: Context, config: Config): void {
  const reporter = new AiHubAuditReporter(ctx, config)
  ctx.on('session/event', (session, event) => { reporter.observe(String(session.id), event) })
  ctx.effect(function* () {
    yield async () => { await reporter.close() }
  }, 'ai-hub conversation audit drain')
}

/** Converts completed Harness turns into bounded, ordered AI Hub audit records. */
export class AiHubAuditReporter {
  private readonly turns = new Map<string, TurnState>()
  private tail = Promise.resolve()
  private pending = 0
  private closed = false
  private readonly hubBaseURL: string
  private readonly maxContentLength: number

  constructor(private readonly ctx: Context, private readonly config: Config) {
    const hub = new URL(config.hubBaseURL)
    const broker = new URL(config.tokenBrokerURL)
    if (!['http:', 'https:'].includes(hub.protocol)) throw new Error('session-audit-ai-hub: Hub URL must be http(s)')
    if (broker.protocol !== 'http:' || broker.hostname !== '127.0.0.1') {
      throw new Error('session-audit-ai-hub: token broker must use loopback HTTP')
    }
    this.hubBaseURL = hub.toString().replace(/\/+$/, '')
    this.maxContentLength = config.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH
  }

  /**
   * Consume one session event and enqueue an audit record after its turn ends.
   * @param sessionId - Stable Harness session identifier.
   * @param event - Session lifecycle event to aggregate.
   */
  observe(sessionId: string, event: SessionEvent): void {
    if (this.closed) return
    if (event.type === 'turn/start') {
      this.turns.set(turnKey(sessionId, event.data.turn), {
        sessionId,
        turn: event.data.turn,
        startedAt: event.time,
        userMessages: [],
        assistantMessages: [],
        inputTokens: 0,
        outputTokens: 0,
      })
      return
    }
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') return
      const turn = latestTurn(this.turns, sessionId)
      if (turn !== undefined) turn.userMessages.push(textContent(event.data.content))
      return
    }
    if (event.type === 'assistant/message') {
      const turn = this.turns.get(turnKey(sessionId, event.data.turn))
      if (turn === undefined) return
      const text = textContent(event.data.message.content)
      if (text.length > 0) turn.assistantMessages.push(text)
      turn.model = event.data.message.source.model
      turn.inputTokens += event.data.usage?.inputTokens ?? 0
      turn.outputTokens += event.data.usage?.outputTokens ?? 0
      return
    }
    if (event.type !== 'turn/end') return
    const key = turnKey(sessionId, event.data.turn)
    const turn = this.turns.get(key)
    this.turns.delete(key)
    if (turn === undefined) return
    this.enqueue(this.payload(turn, event))
  }

  /** Drain queued audit submissions and reject subsequent events. */
  async close(): Promise<void> {
    this.closed = true
    await this.tail
  }

  private payload(turn: TurnState, event: SessionEvent<'turn/end'>): AuditPayload {
    const completedAt = event.time
    const kind = event.data.reason.kind
    const status = kind === 'error' ? 'ERROR' : kind === 'aborted' || kind === 'blocked' ? 'CANCELLED' : 'SUCCESS'
    const errorCode = kind === 'error' ? event.data.reason.error.code : undefined
    return {
      sessionId: bounded(turn.sessionId, 100),
      turnId: String(turn.turn),
      clientInstallationId: bounded(this.config.installationId, 100),
      model: bounded(turn.model ?? this.config.defaultModel ?? 'unknown', 120),
      userMessage: bounded(turn.userMessages.filter(Boolean).join('\n\n'), this.maxContentLength),
      assistantMessage: bounded(turn.assistantMessages.join('\n\n'), this.maxContentLength),
      startedAt: new Date(turn.startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      latencyMs: Math.max(0, completedAt - turn.startedAt),
      status,
      ...errorCode === undefined ? {} : { errorCode: bounded(errorCode, 80) },
    }
  }

  private enqueue(payload: AuditPayload): void {
    if (this.pending >= MAX_PENDING_RECORDS) {
      this.ctx.logger.error('AI Hub 对话审计队列已满，拒绝接收新的审计记录')
      return
    }
    this.pending += 1
    this.tail = this.tail.then(async () => {
      await this.postWithRetry(payload)
    }).catch((error: unknown) => {
      this.ctx.logger.error(`AI Hub 对话审计上报失败: ${errorMessage(error)}`)
    }).finally(() => {
      this.pending -= 1
    })
  }

  private async postWithRetry(payload: AuditPayload): Promise<void> {
    let forceRefresh = false
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const token = await this.accessToken(forceRefresh)
        const response = await fetch(`${this.hubBaseURL}/api/client/conversation-audits`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        })
        if (response.ok) {
          await response.body?.cancel()
          return
        }
        if (response.status === 401 && !forceRefresh) {
          forceRefresh = true
          await response.body?.cancel()
          continue
        }
        const problem = await response.text()
        throw new Error(`HTTP ${response.status}${problem.length === 0 ? '' : `: ${problem.slice(0, 500)}`}`)
      } catch (error) {
        lastError = error
        if (attempt < 2) await delay(250 * (attempt + 1))
      }
    }
    throw lastError
  }

  private async accessToken(force: boolean): Promise<string> {
    const brokerURL = new URL(this.config.tokenBrokerURL)
    if (force) brokerURL.searchParams.set('force', '1')
    const response = await fetch(brokerURL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.tokenBrokerSecret}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`本机 Token Broker 返回 HTTP ${response.status}`)
    const body = await response.json() as { accessToken?: unknown }
    if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
      throw new Error('本机 Token Broker 未返回访问令牌')
    }
    return body.accessToken
  }
}

function latestTurn(turns: ReadonlyMap<string, TurnState>, sessionId: string): TurnState | undefined {
  let latest: TurnState | undefined
  for (const turn of turns.values()) {
    if (turn.sessionId === sessionId && (latest === undefined || turn.turn > latest.turn)) latest = turn
  }
  return latest
}

function turnKey(sessionId: string, turn: number): string {
  return `${sessionId}:${turn}`
}

function textContent(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string'
    ? [block.text]
    : block.type === 'document' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

function bounded(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 12))}\n[truncated]`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
