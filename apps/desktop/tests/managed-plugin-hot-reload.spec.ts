import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { waitForManagedPluginHotReload } from '../src/managed-plugin-hot-reload.ts'

const REVISION = 'a'.repeat(64)

describe('managed plug-in hot reload acknowledgement', () => {
  it('accepts the matching committed revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hot-reload-'))
    const status = join(root, 'status.json')
    await writeFile(status, JSON.stringify({ revision: REVISION, ok: true }))
    await expect(waitForManagedPluginHotReload(status, REVISION, 100, 5)).resolves.toBeUndefined()
  })

  it('surfaces a matching transaction failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hot-reload-'))
    const status = join(root, 'status.json')
    await writeFile(status, JSON.stringify({ revision: REVISION, ok: false, error: 'apply failed' }))
    await expect(waitForManagedPluginHotReload(status, REVISION, 100, 5)).rejects.toThrow('apply failed')
  })

  it('does not accept a stale revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hot-reload-'))
    const status = join(root, 'status.json')
    await writeFile(status, JSON.stringify({ revision: 'b'.repeat(64), ok: true }))
    await expect(waitForManagedPluginHotReload(status, REVISION, 20, 5)).rejects.toThrow('确认超时')
  })
})
