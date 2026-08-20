import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { HubCatalogSyncResult } from './ai-hub-client.ts'

interface PendingGeneration {
  id: string
  attempted: boolean
}

interface RecoveryState {
  pending?: PendingGeneration
}

export interface ManagedCapabilityPaths {
  skillRoot: string
  pluginRoot: string
  pluginPatchPath: string
  instructionRoot: string
}

export interface PreparedCapabilityBoot {
  result?: HubCatalogSyncResult
  restored: boolean
  pendingCandidate: boolean
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

/**
 * Keeps one previous verified managed-capability directory set. A candidate is
 * healthy only after host, web and every renderer plug-in report ready.
 */
export class ManagedCapabilityRecovery {
  private readonly root: string
  private readonly statePath: string
  private readonly activeResultPath: string
  private readonly schedulePath: string

  constructor(harnessHome: string, readonly paths: ManagedCapabilityPaths) {
    this.root = join(harnessHome, 'capability-generations')
    this.statePath = join(this.root, 'state.json')
    this.activeResultPath = join(this.root, 'active-result.json')
    this.schedulePath = join(this.root, 'scheduled-activation.json')
  }

  async readActiveResult(): Promise<HubCatalogSyncResult | undefined> {
    return await this.readResult(this.activeResultPath)
  }

  async writeActiveResult(result: HubCatalogSyncResult): Promise<void> {
    await this.writeJson(this.activeResultPath, result)
  }

  async scheduleActivation(revision: string): Promise<void> {
    await this.writeJson(this.schedulePath, { revision })
  }

  async isActivationScheduled(revision: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(this.schedulePath, 'utf8')) as { revision?: unknown }
      return parsed.revision === revision
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false
      throw error
    }
  }

  async clearActivationSchedule(): Promise<void> {
    await rm(this.schedulePath, { force: true })
  }

  /** Restore an interrupted candidate, or mark a newly staged candidate as attempted. */
  async prepareBoot(): Promise<PreparedCapabilityBoot> {
    const state = await this.readState()
    const pending = state.pending
    if (pending === undefined) return { restored: false, pendingCandidate: false }
    if (pending.attempted) {
      const result = await this.rollback()
      return { ...(result === undefined ? {} : { result }), restored: true, pendingCandidate: false }
    }
    await this.writeState({ pending: { ...pending, attempted: true } })
    const result = await this.readActiveResult()
    return {
      ...(result === undefined ? {} : { result }),
      restored: false,
      pendingCandidate: true,
    }
  }

  /** Snapshot the current healthy directories before Hub content replaces them. */
  async stageUpdate(): Promise<void> {
    const state = await this.readState()
    if (state.pending !== undefined) throw new Error('已有企业能力候选版本正在等待健康校验')
    const id = `${Date.now().toString(36)}-${randomUUID()}`
    const backup = this.backupRoot(id)
    await mkdir(backup, { recursive: true, mode: 0o700 })
    for (const path of this.directoryPaths()) {
      if (await exists(path)) await cp(path, join(backup, basename(path)), { recursive: true, force: true })
    }
    if (await exists(this.paths.pluginPatchPath)) {
      await copyFile(this.paths.pluginPatchPath, join(backup, basename(this.paths.pluginPatchPath)))
    }
    if (await exists(this.activeResultPath)) {
      await copyFile(this.activeResultPath, join(backup, 'active-result.json'))
    }
    await this.writeState({ pending: { id, attempted: false } })
  }

  async markCurrentCandidateAttempted(): Promise<void> {
    const state = await this.readState()
    if (state.pending === undefined || state.pending.attempted) return
    await this.writeState({ pending: { ...state.pending, attempted: true } })
  }

  async markHealthy(): Promise<void> {
    const state = await this.readState()
    if (state.pending !== undefined) await rm(this.backupRoot(state.pending.id), { recursive: true, force: true })
    await this.writeState({})
  }

  async rollback(): Promise<HubCatalogSyncResult | undefined> {
    const state = await this.readState()
    const pending = state.pending
    if (pending === undefined) return undefined
    const backup = this.backupRoot(pending.id)
    for (const path of this.directoryPaths()) await rm(path, { recursive: true, force: true })
    await rm(this.paths.pluginPatchPath, { force: true })
    for (const path of this.directoryPaths()) {
      const source = join(backup, basename(path))
      if (await exists(source)) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await cp(source, path, { recursive: true, force: true })
      }
    }
    const patchBackup = join(backup, basename(this.paths.pluginPatchPath))
    if (await exists(patchBackup)) {
      await mkdir(dirname(this.paths.pluginPatchPath), { recursive: true, mode: 0o700 })
      await copyFile(patchBackup, this.paths.pluginPatchPath)
    }
    const resultBackup = join(backup, 'active-result.json')
    if (await exists(resultBackup)) {
      await mkdir(dirname(this.activeResultPath), { recursive: true, mode: 0o700 })
      await copyFile(resultBackup, this.activeResultPath)
    } else {
      await rm(this.activeResultPath, { force: true })
    }
    const result = await this.readActiveResult()
    await rm(backup, { recursive: true, force: true })
    await this.writeState({})
    return result
  }

  private directoryPaths(): string[] {
    return [this.paths.skillRoot, this.paths.pluginRoot, this.paths.instructionRoot]
  }

  private backupRoot(id: string): string {
    return join(this.root, 'previous', id)
  }

  private async readState(): Promise<RecoveryState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as RecoveryState
      const pending = parsed.pending
      if (pending === undefined) return {}
      if (typeof pending.id !== 'string' || typeof pending.attempted !== 'boolean') return {}
      return { pending }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return {}
      throw error
    }
  }

  private async writeState(state: RecoveryState): Promise<void> {
    await this.writeJson(this.statePath, state)
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const stage = `${path}.tmp-${randomUUID()}`
    await writeFile(stage, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(stage, path)
  }

  private async readResult(path: string): Promise<HubCatalogSyncResult | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as HubCatalogSyncResult
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
      throw error
    }
  }
}
