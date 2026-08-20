import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SCHEMA_VERSION = 4
const MAX_ENTRIES = 200
const MAX_TITLE_CHARS = 48
const MAX_SUMMARY_CHARS = 500
const MAX_JOURNAL_SUMMARY_CHARS = 320
const MAX_TOTAL_CHARS = 80_000
const MAX_JOURNALS_PER_DAY = 4
const JOURNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const DSH_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1_000

export type PersonalMemoryKind = 'PREFERENCE' | 'FACT' | 'CONTEXT' | 'JOURNAL'
export type PersonalMemoryScope = 'GLOBAL' | 'WORKSPACE'

export interface PersonalMemoryEntry {
  id: string
  kind: PersonalMemoryKind
  title: string
  summary: string
  scope: PersonalMemoryScope
  source: 'LOCAL_CONVERSATION'
  workspaceKey?: string
  sourceSessionId?: string
  sourceEventSeq?: number
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

export interface PersonalMemoryState {
  enabled: boolean
  entries: PersonalMemoryEntry[]
}

/** One deterministic candidate extracted from a completed local conversation turn. */
export interface PersonalMemoryCandidate {
  kind: PersonalMemoryKind
  title?: string
  summary: string
  scope: PersonalMemoryScope
  workspaceKey?: string
  sourceSessionId: string
  sourceEventSeq: number
}

interface PersonalMemoryDocument extends PersonalMemoryState {
  schemaVersion: number
  workcode: string
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

function assertWorkcode(workcode: string): void {
  if (!/^\d{5,12}$/.test(workcode)) throw new Error('personal memory requires a valid workcode')
}

function normalizeSummary(summary: string, kind: PersonalMemoryKind): string {
  const normalized = summary.trim().replace(/\s+/g, ' ')
  const limit = kind === 'JOURNAL' ? MAX_JOURNAL_SUMMARY_CHARS : MAX_SUMMARY_CHARS
  if (normalized.length === 0 || normalized.length > limit) {
    throw new Error(`personal memory summary must contain 1..${limit} characters`)
  }
  return normalized
}

function clip(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(1, limit - 1))}…`
}

function defaultTitle(kind: PersonalMemoryKind, summary: string): string {
  const label = kind === 'PREFERENCE' ? '偏好' : kind === 'FACT' ? '事实' : kind === 'CONTEXT' ? '项目上下文' : '近期工作'
  const subject = summary
    .replace(/^(?:目标|用户请求)：/u, '')
    .split(/[;；。！？!?]/u)[0]
    ?.trim()
  return clip(subject === undefined || subject.length < 3 ? label : subject, MAX_TITLE_CHARS)
}

function normalizeTitle(title: string | undefined, kind: PersonalMemoryKind, summary: string): string {
  const normalized = title?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized.length === 0 ? defaultTitle(kind, summary) : clip(normalized, MAX_TITLE_CHARS)
}

function assertKind(kind: string): asserts kind is PersonalMemoryKind {
  if (!['PREFERENCE', 'FACT', 'CONTEXT', 'JOURNAL'].includes(kind)) throw new Error('invalid personal memory kind')
}

function assertScope(scope: string): asserts scope is PersonalMemoryScope {
  if (scope !== 'GLOBAL' && scope !== 'WORKSPACE') throw new Error('invalid personal memory scope')
}

function normalizeWorkspaceKey(value: string | undefined, scope: PersonalMemoryScope): string | undefined {
  if (scope === 'GLOBAL') return undefined
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new Error('invalid personal memory workspace key')
  return value
}

function normalizeSessionId(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 128 || /\s/.test(normalized)) {
    throw new Error('invalid personal memory source session')
  }
  return normalized
}

function normalizeEventSeq(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid personal memory source event')
  return value
}

const SECRET_PATTERNS = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp_|github_pat_|npm_)[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bBearer\s+[a-z0-9._~+/=-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\b(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|secret|password|passwd|口令|密码|密钥)\s*[:=：]\s*["']?\S{8,}/i,
]

function assertNoSecret(text: string): void {
  if (SECRET_PATTERNS.some(pattern => pattern.test(text))) throw new Error('personal memory refuses secret-shaped content')
}

function copyEntry(entry: PersonalMemoryEntry): PersonalMemoryEntry {
  return { ...entry }
}

/** SafeStorage-encrypted, workcode-isolated personal memory document. */
export class PersonalMemoryStore {
  private tail = Promise.resolve()

  constructor(
    private readonly root: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(workcode: string): Promise<PersonalMemoryState> {
    const document = await this.readDocument(workcode)
    return { enabled: document.enabled, entries: document.entries.map(copyEntry) }
  }

  async setEnabled(workcode: string, enabled: boolean): Promise<PersonalMemoryState> {
    return this.mutate(workcode, (document) => {
      document.enabled = enabled
    })
  }

  /** Idempotently merge stable facts plus bounded, workspace-local turn journals. */
  async capture(workcode: string, candidates: readonly PersonalMemoryCandidate[]): Promise<PersonalMemoryState> {
    const normalized = candidates.slice(0, 6).map((candidate) => {
      assertKind(candidate.kind)
      assertScope(candidate.scope)
      if (candidate.kind === 'JOURNAL' && candidate.scope !== 'WORKSPACE') {
        throw new Error('personal memory journals require workspace scope')
      }
      const summary = normalizeSummary(candidate.summary, candidate.kind)
      const title = normalizeTitle(candidate.title, candidate.kind, summary)
      assertNoSecret(`${title} ${summary}`)
      return {
        kind: candidate.kind,
        title,
        summary,
        scope: candidate.scope,
        workspaceKey: normalizeWorkspaceKey(candidate.workspaceKey, candidate.scope),
        sourceSessionId: normalizeSessionId(candidate.sourceSessionId),
        sourceEventSeq: normalizeEventSeq(candidate.sourceEventSeq),
      }
    })
    return this.mutate(workcode, (document) => {
      if (!document.enabled) return
      const now = this.now().toISOString()
      document.entries = pruneExpiredJournals(document.entries, now)
      for (const candidate of normalized) {
        const sourceDuplicate = candidate.kind === 'JOURNAL' && document.entries.some(entry => entry.kind === 'JOURNAL'
          && entry.sourceSessionId === candidate.sourceSessionId
          && entry.sourceEventSeq === candidate.sourceEventSeq)
        if (sourceDuplicate) continue
        const existing = document.entries.find(entry => entry.kind === candidate.kind
          && entry.scope === candidate.scope
          && entry.workspaceKey === candidate.workspaceKey
          && isApproximateDuplicate(entry, candidate))
        if (existing !== undefined) {
          existing.title = candidate.title
          existing.summary = candidate.summary
          existing.source = 'LOCAL_CONVERSATION'
          existing.sourceSessionId = candidate.sourceSessionId
          existing.sourceEventSeq = candidate.sourceEventSeq
          existing.updatedAt = now
          continue
        }
        if (candidate.kind === 'JOURNAL' && journalsForDay(document.entries, now) >= MAX_JOURNALS_PER_DAY) continue
        if (!makeCapacity(document.entries, candidate.title.length + candidate.summary.length)) continue
        document.entries.unshift({
          id: randomUUID(),
          kind: candidate.kind,
          title: candidate.title,
          summary: candidate.summary,
          scope: candidate.scope,
          source: 'LOCAL_CONVERSATION',
          ...candidate.workspaceKey === undefined ? {} : { workspaceKey: candidate.workspaceKey },
          sourceSessionId: candidate.sourceSessionId,
          sourceEventSeq: candidate.sourceEventSeq,
          createdAt: now,
          updatedAt: now,
        })
      }
      assertTotalBudget(document.entries)
    })
  }

  async remove(workcode: string, id: string): Promise<PersonalMemoryState> {
    return this.mutate(workcode, (document) => {
      const next = document.entries.filter(entry => entry.id !== id)
      if (next.length === document.entries.length) throw new Error('personal memory entry was not found')
      document.entries = next
    })
  }

  async clear(workcode: string): Promise<PersonalMemoryState> {
    return this.mutate(workcode, (document) => {
      document.entries = []
    })
  }

  async query(workcode: string, query: string, workspaceKey?: string, limit = 20): Promise<PersonalMemoryEntry[]> {
    const document = await this.readDocument(workcode)
    if (!document.enabled) return []
    if (workspaceKey !== undefined && !/^[a-f0-9]{32}$/.test(workspaceKey)) throw new Error('invalid personal memory workspace key')
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const tokens = memoryTokens(query)
    if (tokens.length === 0) return []
    const scored = document.entries
      .filter(entry => entry.scope === 'GLOBAL' || (workspaceKey !== undefined && entry.workspaceKey === workspaceKey))
      .map((entry) => {
        const haystack = `${entry.title} ${entry.summary}`.toLocaleLowerCase()
        const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? token.length : 0), 0)
        return { entry, score }
      })
    const selected = scored
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt))
      .slice(0, boundedLimit)
      .map(item => copyEntry(item.entry))
    return selected
  }

  private async mutate(workcode: string, change: (document: PersonalMemoryDocument) => void): Promise<PersonalMemoryState> {
    let result: PersonalMemoryState | undefined
    const operation = this.tail.then(async () => {
      const document = await this.readDocument(workcode)
      change(document)
      await this.writeDocument(workcode, document)
      result = { enabled: document.enabled, entries: document.entries.map(copyEntry) }
    })
    this.tail = operation.catch(() => undefined)
    await operation
    if (result === undefined) throw new Error('personal memory update did not complete')
    return result
  }

  private async readDocument(workcode: string): Promise<PersonalMemoryDocument> {
    assertWorkcode(workcode)
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('system credential encryption is unavailable')
    const path = this.pathFor(workcode)
    let encrypted: Buffer
    try {
      encrypted = await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument(workcode)
      throw error
    }
    let cleartext: string
    try {
      cleartext = this.safeStorage.decryptString(encrypted)
    } catch {
      return await this.replaceUnreadableDocument(workcode)
    }
    let parsed: Partial<PersonalMemoryDocument>
    try {
      parsed = JSON.parse(cleartext) as Partial<PersonalMemoryDocument>
    } catch {
      return await this.replaceUnreadableDocument(workcode)
    }
    const schemaVersion = parsed.schemaVersion
    if ((schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== SCHEMA_VERSION) || parsed.workcode !== workcode || typeof parsed.enabled !== 'boolean'
      || !Array.isArray(parsed.entries)) throw new Error('personal memory document is invalid')
    const entries = pruneExpiredJournals(
      parsed.entries.map(value => parseEntry(value, schemaVersion)),
      this.now().toISOString(),
    )
    assertTotalBudget(entries)
    const document = { schemaVersion: SCHEMA_VERSION, workcode, enabled: parsed.enabled, entries }
    if (schemaVersion !== SCHEMA_VERSION) await this.writeDocument(workcode, document)
    return document
  }

  private async replaceUnreadableDocument(workcode: string): Promise<PersonalMemoryDocument> {
    const document = emptyDocument(workcode)
    await this.writeDocument(workcode, document)
    return document
  }

  private async writeDocument(workcode: string, document: PersonalMemoryDocument): Promise<void> {
    const path = this.pathFor(workcode)
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const encrypted = this.safeStorage.encryptString(JSON.stringify(document))
    await writeFile(temporary, encrypted, { mode: 0o600 })
    try {
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private pathFor(workcode: string): string {
    const namespace = createHash('sha256').update(`dsh-harness-memory:${workcode}`).digest('hex').slice(0, 24)
    return join(this.root, namespace, 'memory.bin')
  }
}

function memoryTokens(query: string): string[] {
  const tokens = new Set<string>()
  for (const segment of query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (segment.length < 2) continue
    tokens.add(segment)
    if (/\p{Script=Han}/u.test(segment) && segment.length > 2) {
      for (let index = 0; index < segment.length - 1; index += 1) tokens.add(segment.slice(index, index + 2))
    }
  }
  return [...tokens]
}

function similarityTokens(value: string): Set<string> {
  const ignored = new Set(['已完成', '已确认', '处理结果', '用户请求', '目标', '结论', '完成', '确认', '验证', '通过', '已完', '已确', '已验'])
  return new Set(memoryTokens(value).filter(token => !ignored.has(token)))
}

function semanticSimilarity(left: string, right: string): number {
  const leftTokens = similarityTokens(left)
  const rightTokens = similarityTokens(right)
  if (leftTokens.size < 2 || rightTokens.size < 2) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  const jaccard = intersection / (leftTokens.size + rightTokens.size - intersection)
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size)
  return Math.max(jaccard, containment)
}

function isApproximateDuplicate(
  entry: PersonalMemoryEntry,
  candidate: Pick<PersonalMemoryCandidate, 'kind' | 'title' | 'summary'> & { title: string },
): boolean {
  const left = `${entry.title} ${entry.summary}`.toLocaleLowerCase()
  const right = `${candidate.title} ${candidate.summary}`.toLocaleLowerCase()
  if (left === right || entry.summary.toLocaleLowerCase() === candidate.summary.toLocaleLowerCase()) return true
  const threshold = candidate.kind === 'JOURNAL' ? 0.68 : 0.62
  return semanticSimilarity(left, right) >= threshold
}

function stripLegacyNoise(value: string): string {
  const lines = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<tool[\s\S]*?<\/tool>/gi, ' ')
    .split(/\r?\n/u)
    .filter(line => !/^\s*(?:\|.*\||[$>]\s|(?:OUT|IN|stderr|stdout|Tool call|Bash)\b)/iu.test(line))
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

function migrateLegacySummary(value: string, kind: PersonalMemoryKind): string {
  const clean = stripLegacyNoise(value)
  if (kind !== 'JOURNAL') return normalizeSummary(clip(clean, MAX_SUMMARY_CHARS), kind)
  const goalMatch = clean.match(/(?:用户请求|目标)[：:]\s*([\s\S]*?)(?=(?:处理结果|结论)[：:]|$)/u)
  const resultMatch = clean.match(/(?:处理结果|结论)[：:]\s*([\s\S]*)$/u)
  const goal = clip(goalMatch?.[1] ?? clean, 105)
  const result = clip(resultMatch?.[1] ?? clean, 195)
  return normalizeSummary(clip(`目标：${goal}；结论：${result}`, MAX_JOURNAL_SUMMARY_CHARS), kind)
}

function emptyDocument(workcode: string): PersonalMemoryDocument {
  return { schemaVersion: SCHEMA_VERSION, workcode, enabled: true, entries: [] }
}

function parseEntry(value: unknown, schemaVersion: number): PersonalMemoryEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('personal memory entry is invalid')
  const entry = value as Record<string, unknown>
  const summaryValue = schemaVersion === SCHEMA_VERSION ? entry.summary : entry.text
  if (typeof entry.id !== 'string' || typeof entry.kind !== 'string' || typeof summaryValue !== 'string'
    || (schemaVersion === SCHEMA_VERSION && typeof entry.title !== 'string')
    || (schemaVersion === SCHEMA_VERSION && entry.source !== 'LOCAL_CONVERSATION')
    || typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string'
    || (entry.scope !== undefined && typeof entry.scope !== 'string')
    || (entry.workspaceKey !== undefined && typeof entry.workspaceKey !== 'string')
    || (entry.sourceSessionId !== undefined && typeof entry.sourceSessionId !== 'string')
    || (entry.sourceEventSeq !== undefined && typeof entry.sourceEventSeq !== 'number')
    || (entry.lastUsedAt !== undefined && typeof entry.lastUsedAt !== 'string')) {
    throw new Error('personal memory entry is invalid')
  }
  assertKind(entry.kind)
  if (entry.kind === 'JOURNAL' && schemaVersion < 3) throw new Error('personal memory entry is invalid')
  const scope = schemaVersion === 1 || entry.scope === undefined ? 'GLOBAL' : entry.scope
  assertScope(scope)
  if (entry.kind === 'JOURNAL' && scope !== 'WORKSPACE') throw new Error('personal memory entry is invalid')
  const workspaceKey = normalizeWorkspaceKey(entry.workspaceKey, scope)
  const summary = schemaVersion === SCHEMA_VERSION
    ? normalizeSummary(summaryValue, entry.kind)
    : migrateLegacySummary(summaryValue, entry.kind)
  return {
    id: entry.id,
    kind: entry.kind,
    title: schemaVersion === SCHEMA_VERSION
      ? normalizeTitle(entry.title as string, entry.kind, summary)
      : defaultTitle(entry.kind, summary),
    summary,
    scope,
    source: 'LOCAL_CONVERSATION',
    ...workspaceKey === undefined ? {} : { workspaceKey },
    ...entry.sourceSessionId === undefined ? {} : { sourceSessionId: normalizeSessionId(entry.sourceSessionId) },
    ...entry.sourceEventSeq === undefined ? {} : { sourceEventSeq: normalizeEventSeq(entry.sourceEventSeq) },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...entry.lastUsedAt === undefined ? {} : { lastUsedAt: entry.lastUsedAt },
  }
}

function assertTotalBudget(entries: readonly PersonalMemoryEntry[]): void {
  const total = entries.reduce((sum, entry) => sum + entry.title.length + entry.summary.length, 0)
  if (total > MAX_TOTAL_CHARS) throw new Error(`personal memory character budget is ${MAX_TOTAL_CHARS}`)
}

function journalsForDay(entries: readonly PersonalMemoryEntry[], now: string): number {
  const day = localDayKey(now)
  return entries.filter(entry => entry.kind === 'JOURNAL' && localDayKey(entry.createdAt) === day).length
}

function localDayKey(value: string): string {
  return new Date(Date.parse(value) + DSH_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10)
}

function pruneExpiredJournals(entries: readonly PersonalMemoryEntry[], now: string): PersonalMemoryEntry[] {
  const threshold = Date.parse(now) - JOURNAL_RETENTION_MS
  return entries.filter(entry => entry.kind !== 'JOURNAL' || Date.parse(entry.createdAt) >= threshold)
}

function makeCapacity(entries: PersonalMemoryEntry[], extraCharacters: number): boolean {
  const totalCharacters = (): number => entries.reduce((sum, entry) => sum + entry.title.length + entry.summary.length, 0)
  while (entries.length >= MAX_ENTRIES || totalCharacters() + extraCharacters > MAX_TOTAL_CHARS) {
    const oldestJournal = entries.findLastIndex(entry => entry.kind === 'JOURNAL')
    if (oldestJournal < 0) return false
    entries.splice(oldestJournal, 1)
  }
  return true
}
