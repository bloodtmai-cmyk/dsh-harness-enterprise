import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SUPPORTED_FILE_SYSTEMS = new Set(['NTFS', 'REFS'])

export interface WindowsStorageFinding {
  path: string
  volume: string
  fileSystem: string
  supported: boolean
}

export type WindowsVolumeProbe = (volume: string) => Promise<string | undefined>

function volumeOf(path: string): string {
  if (path.startsWith('\\\\')) {
    const parts = path.split('\\').filter(Boolean)
    return parts.length >= 2 ? `\\\\${parts[0]}\\${parts[1]}\\` : path
  }
  return win32.parse(path).root.toUpperCase()
}

async function probeWindowsVolume(volume: string): Promise<string | undefined> {
  if (volume.startsWith('\\\\')) return 'NETWORK'
  const drive = volume.slice(0, 1).replace(/[^A-Z]/gi, '')
  if (drive.length !== 1) return undefined
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Volume -DriveLetter '${drive}').FileSystemType`,
    ], { timeout: 8_000, windowsHide: true, maxBuffer: 8 * 1024 })
    const result = stdout.trim().toUpperCase()
    return result.length === 0 ? undefined : result
  } catch {
    return undefined
  }
}

/** Inspect distinct install, user-data and managed-capability volumes on Windows. */
export async function inspectWindowsStorage(
  paths: readonly string[],
  probe: WindowsVolumeProbe = probeWindowsVolume,
): Promise<WindowsStorageFinding[]> {
  const byVolume = new Map<string, string>()
  for (const path of paths) {
    const volume = volumeOf(path)
    if (volume.length > 0 && !byVolume.has(volume)) byVolume.set(volume, path)
  }
  const findings: WindowsStorageFinding[] = []
  for (const [volume, path] of byVolume) {
    const fileSystem = (await probe(volume))?.toUpperCase() ?? 'UNKNOWN'
    findings.push({
      path,
      volume,
      fileSystem,
      supported: fileSystem === 'UNKNOWN' || SUPPORTED_FILE_SYSTEMS.has(fileSystem),
    })
  }
  return findings
}
