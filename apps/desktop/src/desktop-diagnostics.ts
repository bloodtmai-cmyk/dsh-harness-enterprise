import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const LOG_HISTORY = 4
const BOOT_MARKER = 'boot-incomplete.json'

export interface DesktopDiagnosticMetadata {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  hubStatus: string
  updateStatus: string
}

export interface PreviousIncompleteBoot {
  startedAt: string
  appVersion: string
  phase: string
}

function desktopLogPath(userData: string, index = 0): string {
  return join(userData, index === 0 ? 'desktop.log' : `desktop.log.${String(index)}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Rotate bounded desktop logs before the backend opens its append stream. */
export async function rotateDesktopLogs(userData: string, maxBytes = MAX_LOG_BYTES): Promise<void> {
  await mkdir(userData, { recursive: true, mode: 0o700 })
  const current = desktopLogPath(userData)
  let size = 0
  try {
    size = (await stat(current)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (size < maxBytes) return
  await rm(desktopLogPath(userData, LOG_HISTORY), { force: true })
  for (let index = LOG_HISTORY - 1; index >= 1; index -= 1) {
    const source = desktopLogPath(userData, index)
    if (await exists(source)) await rename(source, desktopLogPath(userData, index + 1))
  }
  await rename(current, desktopLogPath(userData, 1))
}

export async function appendDesktopDiagnosticEvent(userData: string, message: string): Promise<void> {
  await mkdir(userData, { recursive: true, mode: 0o700 })
  await appendFile(desktopLogPath(userData), `[${new Date().toISOString()}] desktop: ${message}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<jwt-redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '<api-key-redacted>')
    .replace(/((?:api[_ -]?key|password|secret|token)\s*[:=]\s*)[^\s,;"']+/gi, '$1<redacted>')
    .replace(/\/Users\/[^/\s]+/g, '/Users/<user>')
    .replace(/\\Users\\[^\\\s]+/gi, '\\Users\\<user>')
}

export class DesktopBootMarker {
  private readonly path: string

  constructor(private readonly userData: string) {
    this.path = join(userData, BOOT_MARKER)
  }

  async begin(appVersion: string): Promise<PreviousIncompleteBoot | undefined> {
    await mkdir(this.userData, { recursive: true, mode: 0o700 })
    let previous: PreviousIncompleteBoot | undefined
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PreviousIncompleteBoot>
      if (typeof parsed.startedAt === 'string' && typeof parsed.appVersion === 'string'
        && typeof parsed.phase === 'string') {
        previous = parsed as PreviousIncompleteBoot
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await this.update(appVersion, 'starting')
    return previous
  }

  async update(appVersion: string, phase: string): Promise<void> {
    const stage = `${this.path}.tmp-${randomUUID()}`
    await writeFile(stage, `${JSON.stringify({
      startedAt: new Date().toISOString(),
      appVersion,
      phase,
    })}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(stage, this.path)
  }

  async markHealthy(): Promise<void> {
    await rm(this.path, { force: true })
  }
}

/** Export bounded, redacted diagnostics without credentials or conversation content. */
export async function exportDesktopDiagnostics(
  userData: string,
  destination: string,
  metadata: DesktopDiagnosticMetadata,
): Promise<void> {
  const entries: Record<string, Uint8Array> = {}
  for (let index = 0; index <= LOG_HISTORY; index += 1) {
    const path = desktopLogPath(userData, index)
    try {
      const content = await readFile(path, 'utf8')
      entries[`logs/${basename(path)}`] = strToU8(redactDiagnosticText(content.slice(-MAX_LOG_BYTES)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    const marker = await readFile(join(userData, BOOT_MARKER), 'utf8')
    entries[`state/${BOOT_MARKER}`] = strToU8(redactDiagnosticText(marker))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  entries['diagnostics.json'] = strToU8(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...metadata,
  }, null, 2)}\n`)
  await writeFile(destination, zipSync(entries, { level: 6 }), { mode: 0o600 })
}
