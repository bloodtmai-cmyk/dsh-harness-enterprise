import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_QR_BYTES = 1024 * 1024
const QR_POLL_INTERVAL_MS = 200
export const WECOM_READ_SESSION_MS = 7 * 24 * 60 * 60_000
export const WECOM_WRITE_SESSION_MS = 24 * 60 * 60_000

export const WECOM_PLUGIN_EXTERNAL_REF = 'wecom-office'

export function isWeComCapabilityExternalRef(value: string | undefined): value is string {
  return value === WECOM_PLUGIN_EXTERNAL_REF
}

export type WeComSkillAuthStatus =
  | 'unavailable'
  | 'unauthorized'
  | 'authorizing'
  | 'authorized'
  | 'failed'

export interface WeComSkillAuthState {
  capabilityExternalRef: string
  status: WeComSkillAuthStatus
  version?: string
  qrDataUrl?: string
  expiresAt?: string
  writeExpiresAt?: string
  writeReauthenticationRequired?: boolean
  reason?: 'cli-unauthorized' | 'reauthentication-required' | 'expired' | 'workcode-changed'
}

export interface WeComAuthorizationLease {
  workcode: string
  authorizedAt: number
  expiresAt: number
  writeExpiresAt: number
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface StoredLease extends WeComAuthorizationLease {
  schemaVersion: 1
}

const platformPackages: Readonly<Record<string, string>> = {
  'darwin-arm64': '@wecom/cli-darwin-arm64',
  'darwin-x64': '@wecom/cli-darwin-x64',
  'linux-arm64': '@wecom/cli-linux-arm64',
  'linux-x64': '@wecom/cli-linux-x64',
  'win32-x64': '@wecom/cli-win32-x64',
}

function isFile(path: string): Promise<boolean> {
  return stat(path).then(value => value.isFile(), () => false)
}

/** Resolve the bundled official binary first, then a narrow set of system-install fallbacks. */
export async function resolveWeComCliPath(
  platform = process.platform,
  arch = process.arch,
): Promise<string | undefined> {
  const packageName = platformPackages[`${platform}-${arch}`]
  const binaryName = platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli'
  const candidates: string[] = []
  if (packageName !== undefined) {
    try {
      const cliRequire = createRequire(require.resolve('@wecom/cli/package.json'))
      candidates.push(join(dirname(cliRequire.resolve(`${packageName}/package.json`)), 'bin', binaryName))
    } catch {
      // A development install may intentionally rely on a system CLI fallback.
    }
  }
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData !== undefined) candidates.push(join(appData, 'npm', 'wecom-cli.cmd'))
  } else {
    candidates.push('/opt/homebrew/bin/wecom-cli', '/usr/local/bin/wecom-cli', '/usr/bin/wecom-cli')
    if (home !== undefined) candidates.push(join(home, '.local', 'bin', 'wecom-cli'))
  }
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }
  return undefined
}

/** Parse the official CLI's deliberately small machine-readable status response. */
export function parseWeComAuthStatus(output: string): 'authorized' | 'unauthorized' | undefined {
  const lines = output.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(Boolean)
  if (lines.includes('authorized')) return 'authorized'
  if (lines.includes('unauthorized')) return 'unauthorized'
  return undefined
}

interface CommandResult {
  code: number | null
  stdout: string
}

async function runCommand(command: string, args: readonly string[], cwd?: string): Promise<CommandResult> {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...(cwd === undefined ? {} : { cwd }),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (error: unknown, result?: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error !== undefined) rejectRun(error instanceof Error ? error : new Error('WeCom CLI command failed'))
      else if (result !== undefined) resolveRun(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error('WeCom CLI status check timed out'))
    }, 15_000)
    timer.unref()
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes <= MAX_OUTPUT_BYTES) stdout.push(chunk)
    })
    child.stderr.on('data', () => {})
    child.once('error', (error) => { finish(error) })
    child.once('close', (code) => {
      finish(undefined, { code, stdout: Buffer.concat(stdout).toString('utf8') })
    })
  })
}

function baseState(status: WeComSkillAuthStatus, capabilityExternalRef: string): WeComSkillAuthState {
  return { capabilityExternalRef, status }
}

/** Own the one-time official QR flow without exposing credentials to the renderer. */
export class WeComSkillAuthManager {
  private current: WeComSkillAuthState = baseState('unauthorized', WECOM_PLUGIN_EXTERNAL_REF)
  private authorization: ChildProcess | undefined
  private qrTimer: NodeJS.Timeout | undefined
  private cancelled = false
  private readonly listeners = new Set<(state: WeComSkillAuthState) => void>()
  private readonly authRoot: string
  private readonly qrPath: string
  private readonly leasePath: string

  constructor(
    private readonly cliPath: string | undefined,
    userData: string,
    private readonly workcode: string,
    private readonly safeStorage: SafeStorageLike,
    onChanged?: (state: WeComSkillAuthState) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.authRoot = join(userData, 'wecom-skill-auth')
    this.qrPath = join(this.authRoot, 'authorization.png')
    this.leasePath = join(this.authRoot, 'session.bin')
    if (onChanged !== undefined) this.listeners.add(onChanged)
  }

  subscribe(listener: (state: WeComSkillAuthState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async state(capabilityExternalRef = WECOM_PLUGIN_EXTERNAL_REF): Promise<WeComSkillAuthState> {
    this.current = { ...this.current, capabilityExternalRef }
    if (this.authorization !== undefined) return this.current
    return await this.probe()
  }

  async start(capabilityExternalRef = WECOM_PLUGIN_EXTERNAL_REF): Promise<WeComSkillAuthState> {
    this.current = { ...this.current, capabilityExternalRef }
    if (this.authorization !== undefined) return this.current
    if (this.cliPath === undefined) return this.update(baseState('unavailable', capabilityExternalRef))
    const ready = await this.probe()
    if (ready.status === 'unavailable') return ready

    await mkdir(this.authRoot, { recursive: true, mode: 0o700 })
    await rm(this.qrPath, { force: true })
    this.cancelled = false
    this.update({ ...baseState('authorizing', capabilityExternalRef), ...(ready.version === undefined ? {} : { version: ready.version }) })
    const child = spawn(this.cliPath, [
      'auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', 'authorization.png',
    ], {
      cwd: this.authRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.authorization = child
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.once('error', () => {
      if (this.authorization !== child) return
      this.authorization = undefined
      this.stopQrPolling()
      this.update(baseState('failed', this.current.capabilityExternalRef))
    })
    child.once('close', (code) => {
      if (this.authorization !== child) return
      this.authorization = undefined
      this.stopQrPolling()
      void this.complete(code).catch(() => {
        this.update(baseState('failed', this.current.capabilityExternalRef))
      })
    })
    this.qrTimer = setInterval(() => { void this.publishQrCode() }, QR_POLL_INTERVAL_MS)
    this.qrTimer.unref()
    void this.publishQrCode()
    return this.current
  }

  async cancel(capabilityExternalRef = this.current.capabilityExternalRef): Promise<WeComSkillAuthState> {
    this.current = { ...this.current, capabilityExternalRef }
    this.cancelled = true
    this.authorization?.kill('SIGTERM')
    this.authorization = undefined
    this.stopQrPolling()
    await rm(this.qrPath, { force: true }).catch(() => {})
    return await this.probe()
  }

  dispose(): void {
    this.cancelled = true
    this.authorization?.kill('SIGTERM')
    this.authorization = undefined
    this.stopQrPolling()
    void rm(this.qrPath, { force: true })
    this.listeners.clear()
  }

  /** Validate the Harness-owned lease before a managed WeCom Tool starts. */
  async authorizationForTool(write: boolean): Promise<WeComAuthorizationLease | undefined> {
    const lease = await this.readLease()
    if (lease === undefined || lease.workcode !== this.workcode || lease.expiresAt <= this.now()) return undefined
    if (write && lease.writeExpiresAt <= this.now()) return undefined
    return lease
  }

  private async probe(): Promise<WeComSkillAuthState> {
    if (this.cliPath === undefined) return this.update(baseState('unavailable', this.current.capabilityExternalRef))
    try {
      const versionResult = await runCommand(this.cliPath, ['--version'])
      if (versionResult.code !== 0) return this.update(baseState('unavailable', this.current.capabilityExternalRef))
      const version = versionResult.stdout.trim().split(/\s+/).find(value => /^\d+\.\d+\.\d+/.test(value))
      const authResult = await runCommand(this.cliPath, ['auth', 'show', '--status'])
      const status = authResult.code === 0 ? parseWeComAuthStatus(authResult.stdout) : undefined
      if (status === undefined) return this.update({ ...baseState('failed', this.current.capabilityExternalRef), ...(version === undefined ? {} : { version }) })
      if (status === 'unauthorized') {
        return this.update({
          ...baseState('unauthorized', this.current.capabilityExternalRef),
          ...(version === undefined ? {} : { version }),
          reason: 'cli-unauthorized',
        })
      }
      const lease = await this.readLease()
      const reason = lease === undefined
        ? 'reauthentication-required'
        : lease.workcode !== this.workcode
          ? 'workcode-changed'
          : lease.expiresAt <= this.now()
            ? 'expired'
            : undefined
      if (reason !== undefined) {
        return this.update({
          ...baseState('unauthorized', this.current.capabilityExternalRef),
          ...(version === undefined ? {} : { version }),
          reason,
        })
      }
      if (lease === undefined) return this.update(baseState('unauthorized', this.current.capabilityExternalRef))
      return this.update({
        ...baseState('authorized', this.current.capabilityExternalRef),
        ...(version === undefined ? {} : { version }),
        expiresAt: new Date(lease.expiresAt).toISOString(),
        writeExpiresAt: new Date(lease.writeExpiresAt).toISOString(),
        writeReauthenticationRequired: lease.writeExpiresAt <= this.now(),
      })
    } catch {
      return this.update(baseState('unavailable', this.current.capabilityExternalRef))
    }
  }

  private async publishQrCode(): Promise<void> {
    if (this.current.status !== 'authorizing' || this.current.qrDataUrl !== undefined) return
    try {
      const content = await readFile(this.qrPath)
      if (content.length === 0 || content.length > MAX_QR_BYTES
        || content[0] !== 0x89 || content[1] !== 0x50 || content[2] !== 0x4e || content[3] !== 0x47) return
      this.update({ ...this.current, qrDataUrl: `data:image/png;base64,${content.toString('base64')}` })
    } catch {
      // The official CLI writes the QR asynchronously; the bounded poll will retry.
    }
  }

  private async complete(code: number | null): Promise<void> {
    await this.publishQrCode()
    await rm(this.qrPath, { force: true }).catch(() => {})
    if (this.cancelled) {
      this.update(baseState('unauthorized', this.current.capabilityExternalRef))
      return
    }
    if (code !== 0) {
      this.update(baseState('failed', this.current.capabilityExternalRef))
      return
    }
    const authResult = this.cliPath === undefined
      ? undefined
      : await runCommand(this.cliPath, ['auth', 'show', '--status']).catch(() => undefined)
    if (authResult === undefined || authResult.code !== 0 || parseWeComAuthStatus(authResult.stdout) !== 'authorized') {
      this.update(baseState('failed', this.current.capabilityExternalRef))
      return
    }
    const authorizedAt = this.now()
    await this.writeLease({
      workcode: this.workcode,
      authorizedAt,
      expiresAt: authorizedAt + WECOM_READ_SESSION_MS,
      writeExpiresAt: authorizedAt + WECOM_WRITE_SESSION_MS,
    })
    const result = await this.probe()
    if (result.status !== 'authorized') this.update(baseState('failed', this.current.capabilityExternalRef))
  }

  private async readLease(): Promise<WeComAuthorizationLease | undefined> {
    if (!this.safeStorage.isEncryptionAvailable()) return undefined
    try {
      const parsed = JSON.parse(this.safeStorage.decryptString(await readFile(this.leasePath))) as Partial<StoredLease>
      if (parsed.schemaVersion !== 1 || typeof parsed.workcode !== 'string'
        || typeof parsed.authorizedAt !== 'number' || typeof parsed.expiresAt !== 'number'
        || typeof parsed.writeExpiresAt !== 'number') return undefined
      return {
        workcode: parsed.workcode,
        authorizedAt: parsed.authorizedAt,
        expiresAt: parsed.expiresAt,
        writeExpiresAt: parsed.writeExpiresAt,
      }
    } catch {
      return undefined
    }
  }

  private async writeLease(lease: WeComAuthorizationLease): Promise<void> {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('WeCom session encryption is unavailable')
    await mkdir(this.authRoot, { recursive: true, mode: 0o700 })
    const temporary = `${this.leasePath}.${process.pid}.tmp`
    const payload: StoredLease = { schemaVersion: 1, ...lease }
    await writeFile(temporary, this.safeStorage.encryptString(JSON.stringify(payload)), { mode: 0o600 })
    await rename(temporary, this.leasePath)
  }

  private stopQrPolling(): void {
    if (this.qrTimer !== undefined) clearInterval(this.qrTimer)
    this.qrTimer = undefined
  }

  private update(state: WeComSkillAuthState): WeComSkillAuthState {
    this.current = state
    for (const listener of this.listeners) listener(state)
    return state
  }
}
