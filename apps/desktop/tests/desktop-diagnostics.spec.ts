import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopBootMarker,
  exportDesktopDiagnostics,
  rotateDesktopLogs,
} from '../src/desktop-diagnostics.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-diagnostics-'))
  roots.push(value)
  return value
}

describe('desktop diagnostics', () => {
  it('rotates bounded logs and records incomplete boots', async () => {
    const directory = await root()
    await writeFile(join(directory, 'desktop.log'), '12345')
    await rotateDesktopLogs(directory, 5)
    expect(await readFile(join(directory, 'desktop.log.1'), 'utf8')).toBe('12345')

    const marker = new DesktopBootMarker(directory)
    expect(await marker.begin('1.0.0')).toBeUndefined()
    await marker.update('1.0.0', 'starting-host')
    expect(await marker.begin('1.0.1')).toMatchObject({ appVersion: '1.0.0', phase: 'starting-host' })
    await marker.markHealthy()
    expect(await marker.begin('1.0.2')).toBeUndefined()
  })

  it('exports redacted logs and a machine-readable manifest', async () => {
    const directory = await root()
    await writeFile(join(directory, 'desktop.log'), [
      'Authorization: Bearer secret-token',
      'apiKey=sk-abcdefghijklmnop',
      '/Users/cc/private',
    ].join('\n'))
    const target = join(directory, 'diagnostics.zip')
    await exportDesktopDiagnostics(directory, target, {
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      hubStatus: 'synced',
      updateStatus: 'none',
    })
    const archive = unzipSync(await readFile(target))
    const log = strFromU8(archive['logs/desktop.log']!)
    expect(log).not.toContain('secret-token')
    expect(log).not.toContain('sk-abcdefghijklmnop')
    expect(log).toContain('/Users/<user>/private')
    expect(JSON.parse(strFromU8(archive['diagnostics.json']!))).toMatchObject({
      appVersion: '1.0.0',
      hubStatus: 'synced',
    })
  })
})
