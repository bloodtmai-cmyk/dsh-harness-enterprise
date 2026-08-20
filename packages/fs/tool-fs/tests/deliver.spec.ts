import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '../src/index.ts'

const roots: string[] = []
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function execute(path: string, cwd: string, id: string) {
  return await ctx!.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(id),
    name: 'deliver_files',
    arguments: { paths: [path] },
    agent: { session: { header: { cwd } } } as never,
  })
}

describe('deliver_files', () => {
  it('registers only existing files inside the session workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-deliver-files-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-deliver-files-outside-'))
    roots.push(root, outside)
    await mkdir(join(root, 'reports'))
    await writeFile(join(root, 'reports', 'demo.xlsx'), 'xlsx')
    await writeFile(join(outside, 'secret.xlsx'), 'secret')
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FsLocal)
    await ctx.plugin(ToolFs).await()

    expect(ctx.tools.get('deliver_files')?.presentCall?.({ paths: ['reports/demo.xlsx'] })).toEqual({
      card: 'generic',
      title: 'Deliver reports/demo.xlsx',
      kind: 'edit',
      locations: [{ path: 'reports/demo.xlsx' }],
    })
    const accepted = await execute('reports/demo.xlsx', root, 'accepted')
    expect(accepted.isError).toBe(false)
    const content = accepted.content[0]
    expect(content?.type).toBe('text')
    if (content?.type !== 'text') throw new Error('expected text result')
    expect(content.text).toContain('reports/demo.xlsx')
    expect((await execute(join(outside, 'secret.xlsx'), root, 'outside')).isError).toBe(true)
    expect((await execute('missing.xlsx', root, 'missing')).isError).toBe(true)
  })
})
