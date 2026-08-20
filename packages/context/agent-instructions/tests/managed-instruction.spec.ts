import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('enterprise managed AGENTS.md', () => {
  it('loads the read-only Hub file before every ordinary system section without expanding its braces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-agents-'))
    roots.push(root)
    const file = join(root, 'AGENTS.md')
    const hashFile = join(root, 'AGENTS.sha256')
    const initial = '# Enterprise policy\n\nKeep literal {{template}} text.\n'
    await writeFile(file, initial, { mode: 0o600 })
    await chmod(file, 0o400)
    await writeFile(hashFile, `${createHash('sha256').update(initial).digest('hex')}\n`, { mode: 0o600 })
    await chmod(hashFile, 0o400)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'Deployment persona.' })
    await ctx.plugin(AgentInstructions, {
      maxBytes: 0,
      managedInstructionFile: file,
      managedInstructionHashFile: hashFile,
    })

    const assembly = await ctx.systemPrompt.assemble()

    expect(assembly.sections.map(section => section.name)).toEqual([
      'harness:identity',
      AgentInstructions.MANAGED_INSTRUCTION_SECTION,
      'deployment:persona',
    ])
    const prompt = renderPrompt(assembly)
    expect(prompt).toContain('mandatory deployment policy')
    expect(prompt).toContain('Keep literal {{template}} text.')

    const updated = '# Enterprise policy\n\nAppend the required suffix.\n'
    await chmod(file, 0o600)
    await writeFile(file, updated)
    await chmod(file, 0o400)
    const transitionPrompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(transitionPrompt).toContain('Keep literal {{template}} text.')
    expect(transitionPrompt).not.toContain('Append the required suffix.')

    await chmod(hashFile, 0o600)
    await writeFile(hashFile, `${createHash('sha256').update(updated).digest('hex')}\n`)
    await chmod(hashFile, 0o400)
    const updatedPrompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(updatedPrompt).toContain('Append the required suffix.')
    expect(updatedPrompt).not.toContain('Keep literal {{template}} text.')
    await ctx.fiber.dispose()
  })

  it('keeps user and project AGENTS.md disabled when the managed desktop sets maxBytes to zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'disabled-local-agents-'))
    roots.push(root)
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'AGENTS.md'), 'This local file must not load.\n')

    await expect(AgentInstructions.loadBaselineInstructions({ cwd: root, maxBytes: 0 }))
      .resolves.toBeUndefined()
  })
})
