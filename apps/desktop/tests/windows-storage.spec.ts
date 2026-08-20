import { describe, expect, it } from 'vitest'
import { inspectWindowsStorage } from '../src/windows-storage.ts'

describe('Windows storage preflight', () => {
  it('accepts NTFS/ReFS, warns on removable formats and deduplicates volumes', async () => {
    const probes: string[] = []
    const findings = await inspectWindowsStorage([
      'C:\\Program Files\\DSH\\app.exe',
      'C:\\Users\\tester\\AppData',
      'D:\\managed-plugins',
    ], async (volume) => {
      probes.push(volume)
      return volume === 'C:\\' ? 'NTFS' : 'exFAT'
    })
    expect(probes).toEqual(['C:\\', 'D:\\'])
    expect(findings).toEqual([
      expect.objectContaining({ volume: 'C:\\', fileSystem: 'NTFS', supported: true }),
      expect.objectContaining({ volume: 'D:\\', fileSystem: 'EXFAT', supported: false }),
    ])
  })

  it('treats a network share as unsupported', async () => {
    const findings = await inspectWindowsStorage(['\\\\server\\share\\Harness'], async () => 'NETWORK')
    expect(findings[0]).toMatchObject({ volume: '\\\\server\\share\\', supported: false })
  })
})
