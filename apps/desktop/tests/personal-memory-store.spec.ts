import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalMemoryStore } from '../src/personal-memory-store.ts'

const temporaryDirectories: string[] = []
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(Buffer.from(value, 'utf8').map(byte => byte ^ 0xA5)),
  decryptString: (value: Buffer) => Buffer.from(value.map(byte => byte ^ 0xA5)).toString('utf8'),
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; store: PersonalMemoryStore }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personal-memory-'))
  temporaryDirectories.push(root)
  return { root, store: new PersonalMemoryStore(root, cipher) }
}

describe('personal local memory store', () => {
  it('defaults to automatic capture and encrypts a workcode-isolated namespace', async () => {
    const { root, store } = await fixture()

    await expect(store.read('1000001')).resolves.toEqual({ enabled: true, entries: [] })
    await store.capture('1000001', [{
      kind: 'PREFERENCE',
      summary: '答复优先使用中文',
      scope: 'GLOBAL',
      sourceSessionId: 'session-1',
      sourceEventSeq: 2,
    }])

    await expect(store.read('1000001')).resolves.toMatchObject({
      enabled: true,
      entries: [{
        kind: 'PREFERENCE', summary: '答复优先使用中文', scope: 'GLOBAL', source: 'LOCAL_CONVERSATION',
        sourceSessionId: 'session-1', sourceEventSeq: 2,
      }],
    })
    await expect(store.read('5000271')).resolves.toEqual({ enabled: true, entries: [] })
    const [directory] = await (await import('node:fs/promises')).readdir(root)
    expect(directory).toBeTruthy()
    expect((await readFile(join(root, directory!, 'memory.bin'))).includes(Buffer.from('答复优先使用中文'))).toBe(false)
  })

  it('keeps workspace context out of unrelated workspaces and supports user deletion', async () => {
    const { store } = await fixture()
    const workspaceA = 'a'.repeat(32)
    const workspaceB = 'b'.repeat(32)
    const captured = await store.capture('1000001', [
      {
        kind: 'FACT', summary: '我的登录账号就是工号', scope: 'GLOBAL',
        sourceSessionId: 'session-1', sourceEventSeq: 3,
      },
      {
        kind: 'CONTEXT', summary: '我们的项目使用 pnpm', scope: 'WORKSPACE', workspaceKey: workspaceA,
        sourceSessionId: 'session-1', sourceEventSeq: 4,
      },
    ])
    const context = captured.entries.find(entry => entry.kind === 'CONTEXT')
    if (context === undefined) throw new Error('workspace context was not captured')

    await expect(store.query('1000001', '项目 pnpm', workspaceA)).resolves.toMatchObject([{ id: context.id }])
    await expect(store.query('1000001', '项目 pnpm', workspaceB)).resolves.toEqual([])
    await expect(store.query('1000001', '登录账号工号', workspaceB)).resolves.toMatchObject([{ kind: 'FACT' }])
    const afterRemove = await store.remove('1000001', context.id)
    expect(afterRemove.entries.some(entry => entry.id === context.id)).toBe(false)
  })

  it('deduplicates exact and near-duplicate captures and rejects secret-shaped content', async () => {
    const { store } = await fixture()
    const candidate = {
      kind: 'PREFERENCE' as const,
      summary: '以后使用简洁中文',
      scope: 'GLOBAL' as const,
      sourceSessionId: 'session-1',
      sourceEventSeq: 2,
    }
    await store.capture('1000001', [candidate])
    const next = await store.capture('1000001', [{ ...candidate, sourceSessionId: 'session-2', sourceEventSeq: 9 }])
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0]).toMatchObject({ sourceSessionId: 'session-2', sourceEventSeq: 9 })
    const merged = await store.capture('1000001', [{
      ...candidate,
      summary: '以后请使用简洁中文',
      sourceSessionId: 'session-3',
      sourceEventSeq: 11,
    }])
    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]).toMatchObject({ summary: '以后请使用简洁中文', sourceSessionId: 'session-3' })

    await expect(store.capture('1000001', [{
      ...candidate,
      summary: 'API key: sk-abcdefghijklmnopqrstuvwxyz123456',
    }])).rejects.toThrow('refuses secret-shaped content')
  })

  it('keeps multiple stable statements extracted from the same human message', async () => {
    const { store } = await fixture()
    const next = await store.capture('1000001', [
      {
        kind: 'PREFERENCE', summary: '默认使用中文', scope: 'GLOBAL',
        sourceSessionId: 'session-1', sourceEventSeq: 2,
      },
      {
        kind: 'PREFERENCE', summary: '回答保持简洁', scope: 'GLOBAL',
        sourceSessionId: 'session-1', sourceEventSeq: 2,
      },
    ])

    expect(next.entries).toHaveLength(2)
  })

  it('keeps bounded recent-work summaries, deduplicates event retries, and expires them after 30 days', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-personal-memory-'))
    temporaryDirectories.push(root)
    let now = new Date('2026-08-19T10:00:00.000Z')
    const store = new PersonalMemoryStore(root, cipher, () => now)
    const workspace = 'a'.repeat(32)

    await store.capture('1000001', [{
      kind: 'FACT', summary: '我的登录账号就是工号', scope: 'GLOBAL',
      sourceSessionId: 'session-fact', sourceEventSeq: 1,
    }])
    const topics = ['核对库存', '修复登录', '验证图表', '配置日程', '检查考勤', '导出报表', '清理缓存', '升级插件', '更新基线', '同步权限']
    for (let index = 0; index < topics.length; index += 1) {
      await store.capture('1000001', [{
        kind: 'JOURNAL', summary: `目标：${topics[index]}；结论：${topics[index]}已完成并验证通过`,
        scope: 'WORKSPACE', workspaceKey: workspace,
        sourceSessionId: `session-${index}`, sourceEventSeq: 10 + index,
      }])
    }
    const capped = await store.read('1000001')
    expect(capped.entries.filter(entry => entry.kind === 'JOURNAL')).toHaveLength(4)

    await store.capture('1000001', [{
      kind: 'JOURNAL', summary: '目标：重试采集；结论：不应生成第二条摘要', scope: 'WORKSPACE', workspaceKey: workspace,
      sourceSessionId: 'session-0', sourceEventSeq: 10,
    }])
    expect((await store.read('1000001')).entries.filter(entry => entry.kind === 'JOURNAL')).toHaveLength(4)
    await expect(store.capture('1000001', [{
      kind: 'JOURNAL', summary: '目标：全局日志；结论：不允许写入', scope: 'GLOBAL',
      sourceSessionId: 'bad-session', sourceEventSeq: 1,
    }])).rejects.toThrow('journals require workspace scope')

    now = new Date('2026-09-19T10:00:00.000Z')
    const expired = await store.read('1000001')
    expect(expired.entries.filter(entry => entry.kind === 'JOURNAL')).toHaveLength(0)
    expect(expired.entries).toMatchObject([{ kind: 'FACT' }])
  })

  it('migrates legacy journals into short encrypted summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-personal-memory-'))
    temporaryDirectories.push(root)
    const workcode = '1000001'
    const namespace = createHash('sha256').update(`dsh-harness-memory:${workcode}`).digest('hex').slice(0, 24)
    const directory = join(root, namespace)
    await mkdir(directory, { recursive: true })
    const legacy = {
      schemaVersion: 3,
      workcode,
      enabled: true,
      entries: [{
        id: 'legacy-journal', kind: 'JOURNAL', scope: 'WORKSPACE', workspaceKey: 'a'.repeat(32),
        text: `用户请求：核对库存\n\`\`\`bash\ncat huge.log\n\`\`\` 处理结果：已确认数据一致。${'工具过程'.repeat(200)}`,
        sourceSessionId: 'session-old', sourceEventSeq: 8,
        createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
      }],
    }
    await writeFile(join(directory, 'memory.bin'), cipher.encryptString(JSON.stringify(legacy)))
    const store = new PersonalMemoryStore(root, cipher, () => new Date('2026-08-19T00:00:00.000Z'))

    const state = await store.read(workcode)
    expect(state.entries[0]).toMatchObject({
      id: 'legacy-journal', kind: 'JOURNAL', title: '核对库存', source: 'LOCAL_CONVERSATION',
    })
    expect(state.entries[0]?.summary.length).toBeLessThanOrEqual(320)
    expect(state.entries[0]?.summary).not.toContain('cat huge.log')
    const migrated = JSON.parse(cipher.decryptString(await readFile(join(directory, 'memory.bin')))) as { schemaVersion: number; entries: Array<Record<string, unknown>> }
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.entries[0]?.text).toBeUndefined()
  })

  it('replaces an unreadable legacy ciphertext and starts fresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-personal-memory-'))
    temporaryDirectories.push(root)
    const workcode = '1000001'
    const namespace = createHash('sha256').update(`dsh-harness-memory:${workcode}`).digest('hex').slice(0, 24)
    const directory = join(root, namespace)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'memory.bin'), Buffer.from('legacy-ciphertext'))
    let firstDecrypt = true
    const store = new PersonalMemoryStore(root, {
      ...cipher,
      decryptString: (value) => {
        if (firstDecrypt) {
          firstDecrypt = false
          throw new Error('legacy key is unavailable')
        }
        return cipher.decryptString(value)
      },
    })

    await expect(store.read(workcode)).resolves.toEqual({ enabled: true, entries: [] })
    await expect(store.capture(workcode, [{
      kind: 'PREFERENCE', summary: '新版开始使用新的本地记忆', scope: 'GLOBAL',
      sourceSessionId: 'session-new', sourceEventSeq: 1,
    }])).resolves.toMatchObject({ entries: [{ summary: '新版开始使用新的本地记忆' }] })
  })

  it('fails closed when system credential encryption is unavailable', async () => {
    const { root } = await fixture()
    const store = new PersonalMemoryStore(root, { ...cipher, isEncryptionAvailable: () => false })

    await expect(store.read('1000001')).rejects.toThrow('system credential encryption is unavailable')
  })
})
