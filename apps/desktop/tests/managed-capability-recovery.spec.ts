import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HubCatalogSyncResult } from '../src/ai-hub-client.ts'
import { ManagedCapabilityRecovery } from '../src/managed-capability-recovery.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function result(version: string): HubCatalogSyncResult {
  return {
    workBuddyEnabled: false,
    skillCount: 0,
    pluginCount: 1,
    instructionCount: 0,
    snapshot: {
      available: true,
      mcps: [],
      skills: [],
      bundles: [],
      plugins: [{
        id: version,
        type: 'CLIENT_PLUGIN',
        externalRef: 'agent-reach',
        name: 'Agent Reach',
        releaseVersion: version,
      }],
      instructions: [],
      evaluatedAt: '2026-08-18T00:00:00Z',
    },
  }
}

describe('managed capability recovery', () => {
  it('persists a deferred activation target until it is consumed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-capability-'))
    roots.push(home)
    const recovery = new ManagedCapabilityRecovery(home, {
      skillRoot: join(home, 'hub-skills'),
      pluginRoot: join(home, 'profiles', 'hub-plugins'),
      pluginPatchPath: join(home, 'hub-plugins.patch.yml'),
      instructionRoot: join(home, 'hub-instructions'),
    })
    await recovery.scheduleActivation('revision-2')
    expect(await recovery.isActivationScheduled('revision-2')).toBe(true)
    expect(await recovery.isActivationScheduled('revision-3')).toBe(false)
    await recovery.clearActivationSchedule()
    expect(await recovery.isActivationScheduled('revision-2')).toBe(false)
  })

  it('restores the last healthy generation after an interrupted candidate boot', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-capability-'))
    roots.push(home)
    const paths = {
      skillRoot: join(home, 'hub-skills'),
      pluginRoot: join(home, 'profiles', 'hub-plugins'),
      pluginPatchPath: join(home, 'hub-plugins.patch.yml'),
      instructionRoot: join(home, 'hub-instructions'),
    }
    const recovery = new ManagedCapabilityRecovery(home, paths)
    await writeFile(paths.pluginPatchPath, 'healthy')
    await recovery.writeActiveResult(result('1.0.0'))
    await recovery.stageUpdate()
    await writeFile(paths.pluginPatchPath, 'broken')
    await recovery.writeActiveResult(result('2.0.0'))

    const first = await recovery.prepareBoot()
    expect(first.pendingCandidate).toBe(true)
    expect(first.result?.snapshot.plugins[0]?.releaseVersion).toBe('2.0.0')

    const second = await recovery.prepareBoot()
    expect(second.restored).toBe(true)
    expect(second.result?.snapshot.plugins[0]?.releaseVersion).toBe('1.0.0')
    expect(await readFile(paths.pluginPatchPath, 'utf8')).toBe('healthy')
  })
})
