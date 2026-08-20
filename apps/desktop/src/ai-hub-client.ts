import { createHash, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Unzip, UnzipInflate } from 'fflate'
import { stringify as stringifyYaml } from 'yaml'

const MAX_SKILL_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_SKILL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024
const MAX_SKILL_ENTRIES = 256
const MAX_PLUGIN_ARTIFACT_BYTES = 20 * 1024 * 1024
const MAX_PLUGIN_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
const MAX_PLUGIN_ENTRIES = 1024
const MAX_INSTRUCTION_ARTIFACT_BYTES = 512 * 1024
const MAX_MANAGED_INSTRUCTION_BYTES = 1024 * 1024
const MAX_DESKTOP_RELEASE_BYTES = 300 * 1024 * 1024

export interface HubKeyApplication {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED'
  keyStatus?: 'AVAILABLE' | 'CLAIMED' | 'REVOKED' | 'EXPIRED'
  claimedAt?: string
  expiresAt?: string
  decisionComment?: string
  provider?: string | null
  baseUrl?: string | null
}

export interface HubClaimedKey {
  apiKey: string
  provider: string
  baseUrl: string
}

type HubClaimedKeyResponse = Omit<HubClaimedKey, 'provider' | 'baseUrl'> & {
  provider?: string | null
  baseUrl?: string | null
}

export type HubCapabilityType = 'MCP' | 'TOOL' | 'SKILL' | 'BUNDLE' | 'CLIENT_PLUGIN' | 'INSTRUCTION'

export interface HubCapability {
  id: string
  type: HubCapabilityType
  externalRef: string
  name: string
  description?: string
  releaseVersion: string
  integrityHash?: string
}

export interface HubCatalog {
  mcps: Array<{ mcp: HubCapability; tools: HubCapability[] }>
  skills: HubCapability[]
  bundles: Array<{ bundle: HubCapability; members: HubCapability[] }>
  plugins?: HubCapability[]
  instructions?: HubCapability[]
  evaluatedAt: string
}

export interface HubCapabilityView {
  id: string
  type: HubCapabilityType
  externalRef: string
  name: string
  description?: string
  releaseVersion: string
  integrityHash?: string
}

export interface HubCatalogSnapshot {
  available: true
  mcps: Array<{ mcp: HubCapabilityView; tools: HubCapabilityView[] }>
  skills: HubCapabilityView[]
  bundles: Array<{ bundle: HubCapabilityView; members: HubCapabilityView[] }>
  plugins: HubCapabilityView[]
  instructions: HubCapabilityView[]
  evaluatedAt: string
}

/** Independent catalog identities for hot-swapped plug-ins, Skills, and policy. */
export interface HubCatalogRevisions {
  activation: string
  gateway: string
  skills: string
  instructions: string
}

/** Keep managed plug-ins below the profile module fallback used by external ESM entries. */
export function resolveManagedPluginRoot(harnessHome: string): string {
  return join(harnessHome, 'profiles', 'hub-plugins')
}

/** One authorized managed plug-in whose published version changed in place. */
export interface HubCapabilityVersionChange {
  type: 'CLIENT_PLUGIN'
  externalRef: string
  name: string
  fromVersion: string
  toVersion: string
}

/** One hot-swappable plug-in grant, revocation, or in-place version replacement. */
export interface HubCapabilityActivationChange extends HubCapabilityVersionChange {
  action: 'GRANTED' | 'REVOKED' | 'UPDATED'
}

/** Track each independently refreshed part of the managed catalog. */
export function catalogRevisions(snapshot: Pick<HubCatalog, 'mcps' | 'skills' | 'bundles' | 'plugins' | 'instructions'>): HubCatalogRevisions {
  return {
    activation: JSON.stringify({
      plugins: (snapshot.plugins ?? []).map(item => [item.id, item.releaseVersion]),
    }),
    gateway: JSON.stringify(snapshot.mcps.map(item => [
      item.mcp.id,
      item.mcp.releaseVersion,
      item.tools.map(tool => [tool.id, tool.releaseVersion]),
    ])),
    skills: JSON.stringify(snapshot.skills
      .map(item => [item.id, item.releaseVersion, item.integrityHash])),
    instructions: JSON.stringify((snapshot.instructions ?? [])
      .map(item => [item.id, item.releaseVersion, item.integrityHash])),
  }
}

interface CatalogVersionEntry {
  key: string
  type: 'CLIENT_PLUGIN'
  capability: HubCapability
}

function pluginCatalogEntries(
  catalog: Pick<HubCatalog, 'plugins'>,
): CatalogVersionEntry[] {
  return (catalog.plugins ?? []).map(capability => ({
    key: `CLIENT_PLUGIN:${capability.externalRef}`,
    type: 'CLIENT_PLUGIN' as const,
    capability,
  }))
}

/** Find version replacements without treating grants, revocations, or topology changes as upgrades. */
export function catalogVersionChanges(
  current: Pick<HubCatalog, 'plugins'>,
  latest: Pick<HubCatalog, 'plugins'>,
): HubCapabilityVersionChange[] {
  const installed = new Map(pluginCatalogEntries(current).map(entry => [entry.key, entry.capability]))
  return pluginCatalogEntries(latest).flatMap(({ key, type, capability }) => {
    const previous = installed.get(key)
    if (previous === undefined || previous.releaseVersion === capability.releaseVersion) return []
    return [{
      type,
      externalRef: capability.externalRef,
      name: capability.name,
      fromVersion: previous.releaseVersion,
      toVersion: capability.releaseVersion,
    }]
  })
}

/** Describe every managed plug-in authorization delta. */
export function catalogActivationChanges(
  current: Pick<HubCatalog, 'plugins'>,
  latest: Pick<HubCatalog, 'plugins'>,
): HubCapabilityActivationChange[] {
  const currentEntries = new Map(pluginCatalogEntries(current).map(entry => [entry.key, entry]))
  const latestEntries = new Map(pluginCatalogEntries(latest).map(entry => [entry.key, entry]))
  const keys = [...new Set([...currentEntries.keys(), ...latestEntries.keys()])].sort()
  return keys.flatMap<HubCapabilityActivationChange>((key) => {
    const previous = currentEntries.get(key)
    const next = latestEntries.get(key)
    if (previous === undefined && next !== undefined) {
      return [{
        action: 'GRANTED' as const,
        type: next.type,
        externalRef: next.capability.externalRef,
        name: next.capability.name,
        fromVersion: '',
        toVersion: next.capability.releaseVersion,
      }]
    }
    if (previous !== undefined && next === undefined) {
      return [{
        action: 'REVOKED' as const,
        type: previous.type,
        externalRef: previous.capability.externalRef,
        name: previous.capability.name,
        fromVersion: previous.capability.releaseVersion,
        toVersion: '',
      }]
    }
    if (previous === undefined || next === undefined
      || previous.capability.releaseVersion === next.capability.releaseVersion) return []
    return [{
      action: 'UPDATED' as const,
      type: next.type,
      externalRef: next.capability.externalRef,
      name: next.capability.name,
      fromVersion: previous.capability.releaseVersion,
      toVersion: next.capability.releaseVersion,
    }]
  })
}

/** Apply hot content now while retaining the active plug-in set until Host is ready. */
export function deferRestartBoundCatalog(
  active: Pick<HubCatalog, 'plugins'>,
  latest: HubCatalog,
): HubCatalog {
  return {
    ...latest,
    plugins: active.plugins ?? [],
  }
}

/** Return true only when the activation delta consists entirely of in-place version replacements. */
export function isCatalogVersionOnlyChange(
  current: Pick<HubCatalog, 'mcps' | 'skills' | 'bundles' | 'plugins' | 'instructions'>,
  latest: Pick<HubCatalog, 'mcps' | 'skills' | 'bundles' | 'plugins' | 'instructions'>,
): boolean {
  const currentEntries = pluginCatalogEntries(current)
  const latestEntries = pluginCatalogEntries(latest)
  if (currentEntries.length !== latestEntries.length) return false
  const currentKeys = currentEntries.map(entry => entry.key).sort()
  const latestKeys = latestEntries.map(entry => entry.key).sort()
  if (JSON.stringify(currentKeys) !== JSON.stringify(latestKeys)) return false
  return catalogVersionChanges(current, latest).length > 0
}

export interface HubCatalogSyncResult {
  workBuddyEnabled: boolean
  skillCount: number
  pluginCount: number
  instructionCount: number
  pluginPatchRevision?: string
  managedInstructionFile?: string
  managedInstructionHashFile?: string
  snapshot: HubCatalogSnapshot
}

export function catalogSnapshot(catalog: HubCatalog): HubCatalogSnapshot {
  return {
    available: true,
    mcps: catalog.mcps.map(item => ({
      mcp: capabilityView(item.mcp),
      tools: item.tools.map(capabilityView),
    })),
    skills: catalog.skills.map(capabilityView),
    bundles: catalog.bundles.map(item => ({
      bundle: capabilityView(item.bundle),
      members: item.members.map(capabilityView),
    })),
    plugins: (catalog.plugins ?? []).map(capabilityView),
    instructions: (catalog.instructions ?? []).map(capabilityView),
    evaluatedAt: catalog.evaluatedAt,
  }
}

export type HubKeyResolution =
  | { state: 'claimed'; applicationId: string; key: HubClaimedKey }
  | { state: 'pending' }
  | { state: 'application-required'; message?: string }
  | { state: 'claimed-elsewhere'; applicationId: string; provider: string; baseUrl: string }

export type HubDesktopReleasePlatform = 'MAC_ARM64' | 'MAC_X64' | 'WINDOWS_X64'

export interface HubDesktopRelease {
  id: string
  version: string
  platform: HubDesktopReleasePlatform
  status: 'PUBLISHED'
  fileName: string
  sizeBytes: number
  sha256: string
  releaseNotes: string
}

/** Map one supported Electron target to the AI Hub release platform contract. */
export function desktopReleasePlatform(
  operatingSystem: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): HubDesktopReleasePlatform | undefined {
  if (operatingSystem === 'darwin' && architecture === 'arm64') return 'MAC_ARM64'
  if (operatingSystem === 'darwin' && architecture === 'x64') return 'MAC_X64'
  if (operatingSystem === 'win32' && architecture === 'x64') return 'WINDOWS_X64'
  return undefined
}

export class AiHubError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message)
  }
}

export class AiHubClient {
  private readonly baseURL: string

  constructor(
    baseURL: string,
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('AI_HUB_BASE_URL 只允许 http 或 https')
    this.baseURL = url.toString().replace(/\/+$/, '')
  }

  async resolveKey(): Promise<HubKeyResolution> {
    const applications = await this.json<HubKeyApplication[]>('/api/client/key-applications')
    const latest = applications[0]
    if (latest === undefined || latest.status === 'REJECTED' || latest.status === 'REVOKED') {
      return { state: 'application-required', ...latest?.decisionComment ? { message: latest.decisionComment } : {} }
    }
    if (latest.status === 'PENDING') return { state: 'pending' }
    if (latest.keyStatus === 'REVOKED'
      || latest.keyStatus === 'EXPIRED'
      || (latest.expiresAt !== undefined && Date.parse(latest.expiresAt) <= Date.now())) {
      return { state: 'application-required', message: '当前没有有效的 API Key，请提交申请。' }
    }
    if (latest.keyStatus === 'AVAILABLE' && latest.claimedAt === undefined) {
      const key = await this.json<HubClaimedKeyResponse>(`/api/client/key-applications/${encodeURIComponent(latest.id)}/secret:claim`, {
        method: 'POST',
      })
      const provider = nonEmptyHubValue(key.provider)
      const baseUrl = nonEmptyHubValue(key.baseUrl)
      if (provider === undefined || baseUrl === undefined) {
        return { state: 'application-required', message: '模型访问地址尚未配置，请联系管理员。' }
      }
      return { state: 'claimed', applicationId: latest.id, key: { ...key, provider, baseUrl } }
    }
    if (latest.keyStatus === 'CLAIMED' && latest.claimedAt !== undefined) {
      const provider = nonEmptyHubValue(latest.provider)
      const baseUrl = nonEmptyHubValue(latest.baseUrl)
      if (provider === undefined || baseUrl === undefined) {
        return { state: 'application-required', message: '模型访问地址尚未配置，请联系管理员。' }
      }
      return {
        state: 'claimed-elsewhere',
        applicationId: latest.id,
        provider,
        baseUrl,
      }
    }
    return { state: 'application-required', message: 'API Key 尚未配置，请等待管理员处理。' }
  }

  async applyForKey(models: readonly string[]): Promise<HubKeyApplication> {
    return await this.json<HubKeyApplication>('/api/client/key-applications', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'Harness Enterprise Desktop模型访问', models }),
    })
  }

  async catalog(): Promise<HubCatalog> {
    return await this.json<HubCatalog>('/api/client/catalog')
  }

  async latestDesktopRelease(platform: HubDesktopReleasePlatform, currentVersion: string): Promise<HubDesktopRelease | undefined> {
    const query = new URLSearchParams({ platform, currentVersion })
    const response = await this.request(`/api/client/desktop-releases/latest?${query.toString()}`)
    if (response.status === 204) return undefined
    let value: unknown
    try {
      value = await response.json()
    } catch (_error) {
      throw new AiHubError('INVALID_DESKTOP_RELEASE', 'AI Hub 返回了无效的客户端版本信息')
    }
    return validateDesktopRelease(value, platform)
  }

  async downloadDesktopRelease(
    release: HubDesktopRelease,
    root: string,
    onProgress: (progress: number) => void = () => {},
  ): Promise<string> {
    validateDesktopRelease(release, release.platform)
    const extension = desktopReleaseExtension(release.fileName, release.platform)
    const target = join(root, `${release.id}${extension}`)
    const stage = `${target}.part-${randomUUID()}`
    await mkdir(root, { recursive: true, mode: 0o700 })
    const response = await this.request(`/api/client/desktop-releases/${encodeURIComponent(release.id)}/artifact`, {
      signal: AbortSignal.timeout(10 * 60_000),
    })
    const declared = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared !== release.sizeBytes) {
      await response.body?.cancel()
      throw new AiHubError('DESKTOP_RELEASE_SIZE_MISMATCH', '客户端安装制品大小与发布信息不一致')
    }
    if (response.body === null) throw new AiHubError('EMPTY_DESKTOP_RELEASE', '客户端安装制品为空')

    const digest = createHash('sha256')
    let received = 0
    const file = await open(stage, 'wx', 0o600)
    const reader = response.body.getReader()
    try {
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          received += chunk.value.byteLength
          if (received > release.sizeBytes || received > MAX_DESKTOP_RELEASE_BYTES) {
            throw new AiHubError('DESKTOP_RELEASE_TOO_LARGE', '客户端安装制品超过发布大小')
          }
          digest.update(chunk.value)
          await file.writeFile(chunk.value)
          onProgress(Math.min(received / release.sizeBytes, 1))
        }
        await file.sync()
      } catch (error) {
        await reader.cancel().catch(() => {})
        throw error
      } finally {
        await file.close()
      }
    } catch (error) {
      await rm(stage, { force: true })
      throw error
    }

    const actualHash = digest.digest('hex')
    if (received !== release.sizeBytes || actualHash !== release.sha256) {
      await rm(stage, { force: true })
      throw new AiHubError('DESKTOP_RELEASE_INTEGRITY_MISMATCH', '客户端安装制品完整性校验失败')
    }
    await chmod(stage, 0o400)
    await rm(target, { force: true })
    await rename(stage, target)
    onProgress(1)
    return target
  }

  async synchronizeCatalog(
    skillRoot: string,
    pluginRoot = resolveManagedPluginRoot(dirname(skillRoot)),
    pluginPatchPath = join(dirname(skillRoot), 'hub-plugins.patch.yml'),
    instructionRoot = join(dirname(skillRoot), 'hub-instructions'),
    catalogOverride?: HubCatalog,
    options: { preserveSkillRoot?: boolean; preservePluginRoot?: boolean } = {},
  ): Promise<HubCatalogSyncResult> {
    const catalog = catalogOverride ?? await this.catalog()
    const stageId = randomUUID()
    const skillStage = `${skillRoot}.stage-${stageId}`
    const pluginStage = `${pluginRoot}.stage-${stageId}`
    const instructionStage = `${instructionRoot}.stage-${stageId}`
    await rm(skillStage, { recursive: true, force: true })
    await rm(pluginStage, { recursive: true, force: true })
    await rm(instructionStage, { recursive: true, force: true })
    await mkdir(skillStage, { recursive: true, mode: 0o700 })
    await mkdir(pluginStage, { recursive: true, mode: 0o700 })
    await mkdir(instructionStage, { recursive: true, mode: 0o700 })
    let managedInstructionHash: string | undefined
    let pluginPatchRevision: string | undefined
    try {
      for (const skill of catalog.skills) await this.downloadSkill(skill, skillStage)
      const installedPlugins: InstalledPlugin[] = []
      if (options.preservePluginRoot) {
        await copyBundledPluginSkills(skillRoot, skillStage)
      } else {
        for (const plugin of catalog.plugins ?? []) {
          installedPlugins.push(await this.downloadPlugin(plugin, pluginStage, skillStage))
        }
      }
      const managedInstructions: ManagedInstruction[] = []
      for (const instruction of catalog.instructions ?? []) {
        managedInstructions.push(await this.downloadInstruction(instruction))
      }
      if (managedInstructions.length > 0) {
        const managedFile = join(instructionStage, 'AGENTS.md')
        const rendered = renderManagedInstructionFile(managedInstructions)
        if (Buffer.byteLength(rendered, 'utf8') > MAX_MANAGED_INSTRUCTION_BYTES) {
          throw new AiHubError('INSTRUCTIONS_TOO_LARGE', '企业指令合并后超过 1 MiB')
        }
        await writeFile(managedFile, rendered, { encoding: 'utf8', mode: 0o600 })
        await chmod(managedFile, 0o400)
        managedInstructionHash = createHash('sha256').update(rendered, 'utf8').digest('hex')
        const managedHashFile = join(instructionStage, 'AGENTS.sha256')
        await writeFile(managedHashFile, `${managedInstructionHash}\n`, { encoding: 'utf8', mode: 0o600 })
        await chmod(managedHashFile, 0o400)
      }
      if (options.preserveSkillRoot) {
        await replaceDirectoryContents(skillStage, skillRoot)
      } else {
        await rm(skillRoot, { recursive: true, force: true })
        await mkdir(dirname(skillRoot), { recursive: true, mode: 0o700 })
        await rename(skillStage, skillRoot)
      }
      await rm(instructionRoot, { recursive: true, force: true })
      await mkdir(dirname(instructionRoot), { recursive: true, mode: 0o700 })
      await rename(instructionStage, instructionRoot)
      if (options.preservePluginRoot) {
        pluginPatchRevision = await fileSha256(pluginPatchPath)
        await rm(pluginStage, { recursive: true, force: true })
      } else {
        await rm(pluginRoot, { recursive: true, force: true })
        await mkdir(dirname(pluginRoot), { recursive: true, mode: 0o700 })
        await rename(pluginStage, pluginRoot)
        pluginPatchRevision = await writeManagedPluginPatch(pluginPatchPath, pluginRoot, installedPlugins)
      }
    } catch (error) {
      await rm(skillStage, { recursive: true, force: true })
      await rm(pluginStage, { recursive: true, force: true })
      await rm(instructionStage, { recursive: true, force: true })
      throw error
    }
    return {
      workBuddyEnabled: catalog.mcps.some(item => item.tools.length > 0),
      skillCount: catalog.skills.length,
      pluginCount: catalog.plugins?.length ?? 0,
      instructionCount: catalog.instructions?.length ?? 0,
      ...(pluginPatchRevision === undefined ? {} : { pluginPatchRevision }),
      ...(managedInstructionHash === undefined
        ? {}
        : {
          managedInstructionFile: join(instructionRoot, 'AGENTS.md'),
          managedInstructionHashFile: join(instructionRoot, 'AGENTS.sha256'),
        }),
      snapshot: catalogSnapshot(catalog),
    }
  }

  private async downloadInstruction(instruction: HubCapability): Promise<ManagedInstruction> {
    const response = await this.request(`/api/client/instructions/${encodeURIComponent(instruction.id)}/artifact`)
    const declared = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > MAX_INSTRUCTION_ARTIFACT_BYTES) {
      await response.body?.cancel()
      throw new AiHubError('INSTRUCTION_TOO_LARGE', `企业指令 ${instruction.externalRef} 超过 512 KiB`)
    }
    const content = new Uint8Array(await response.arrayBuffer())
    if (content.byteLength === 0 || content.byteLength > MAX_INSTRUCTION_ARTIFACT_BYTES) {
      throw new AiHubError('INSTRUCTION_TOO_LARGE', `企业指令 ${instruction.externalRef} 大小无效`)
    }
    const actualHash = createHash('sha256').update(content).digest('hex')
    if (instruction.integrityHash === undefined || actualHash !== instruction.integrityHash) {
      throw new AiHubError('INSTRUCTION_INTEGRITY_MISMATCH', `企业指令 ${instruction.externalRef} 完整性校验失败`)
    }
    let markdown: string
    try {
      markdown = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch {
      throw new AiHubError('INVALID_INSTRUCTION_ENCODING', `企业指令 ${instruction.externalRef} 不是有效 UTF-8`)
    }
    if (markdown.trim().length === 0) {
      throw new AiHubError('EMPTY_INSTRUCTION', `企业指令 ${instruction.externalRef} 为空`)
    }
    return { capability: instruction, markdown }
  }

  private async downloadPlugin(plugin: HubCapability, pluginRoot: string, skillRoot: string): Promise<InstalledPlugin> {
    const response = await this.request(`/api/client/client-plugins/${encodeURIComponent(plugin.id)}/artifact`)
    const declared = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > MAX_PLUGIN_ARTIFACT_BYTES) {
      await response.body?.cancel()
      throw new AiHubError('PLUGIN_TOO_LARGE', `插件 ${plugin.externalRef} 超过 20 MiB`)
    }
    const content = new Uint8Array(await response.arrayBuffer())
    if (content.byteLength > MAX_PLUGIN_ARTIFACT_BYTES) {
      throw new AiHubError('PLUGIN_TOO_LARGE', `插件 ${plugin.externalRef} 超过 20 MiB`)
    }
    const actualHash = createHash('sha256').update(content).digest('hex')
    if (plugin.integrityHash !== undefined && actualHash !== plugin.integrityHash) {
      throw new AiHubError('PLUGIN_INTEGRITY_MISMATCH', `插件 ${plugin.externalRef} 完整性校验失败`)
    }
    return await extractPluginZip(content, plugin, join(pluginRoot, plugin.id), skillRoot)
  }

  private async downloadSkill(skill: HubCapability, root: string): Promise<void> {
    const response = await this.request(`/api/client/skills/${encodeURIComponent(skill.id)}/artifact`)
    const declared = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > MAX_SKILL_ARTIFACT_BYTES) {
      await response.body?.cancel()
      throw new AiHubError('SKILL_TOO_LARGE', `Skill ${skill.externalRef} 超过 2 MiB`)
    }
    const content = new Uint8Array(await response.arrayBuffer())
    if (content.byteLength > MAX_SKILL_ARTIFACT_BYTES) {
      throw new AiHubError('SKILL_TOO_LARGE', `Skill ${skill.externalRef} 超过 2 MiB`)
    }
    const actualHash = createHash('sha256').update(content).digest('hex')
    if (skill.integrityHash !== undefined && actualHash !== skill.integrityHash) {
      throw new AiHubError('SKILL_INTEGRITY_MISMATCH', `Skill ${skill.externalRef} 完整性校验失败`)
    }
    const mediaType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (mediaType.includes('zip')) {
      await extractSkillZip(content, join(root, skill.id))
      return
    }
    await writeFile(join(root, `${skill.externalRef}.md`), content, { mode: 0o600 })
  }

  private async json<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Content-Type', 'application/json')
    const response = await this.request(path, {
      ...init,
      headers,
    })
    if (response.status === 204) return undefined as T
    try {
      return await response.json() as T
    } catch (_error) {
      throw new AiHubError('INVALID_AI_HUB_RESPONSE', 'AI Hub 返回了无效 JSON', response.status)
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${this.accessToken}`)
    headers.set('Accept', 'application/json')
    try {
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(15_000),
      })
    } catch (_error) {
      throw new AiHubError('AI_HUB_UNAVAILABLE', 'AI Hub 暂不可用，请检查当前网络')
    }
    if (response.ok) return response
    let code = `AI_HUB_HTTP_${response.status}`
    let message = 'AI Hub 请求失败'
    try {
      const body = await response.json() as { code?: unknown; message?: unknown }
      if (typeof body.code === 'string') code = body.code
      if (typeof body.message === 'string') message = body.message
    } catch {
      await response.body?.cancel()
    }
    throw new AiHubError(code, message, response.status)
  }
}

function nonEmptyHubValue(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

/** Replace entries while preserving the watched Skill root inode for live catalog invalidation. */
async function replaceDirectoryContents(stage: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 })
  const previous = `${stage}.previous`
  const previousNames: string[] = []
  const nextNames: string[] = []
  await rm(previous, { recursive: true, force: true })
  await mkdir(previous, { recursive: true, mode: 0o700 })
  try {
    for (const name of await readdir(target)) {
      await rename(join(target, name), join(previous, name))
      previousNames.push(name)
    }
    for (const name of await readdir(stage)) {
      await rename(join(stage, name), join(target, name))
      nextNames.push(name)
    }
    await rm(previous, { recursive: true, force: true })
    await rm(stage, { recursive: true, force: true })
  } catch (error) {
    for (const name of nextNames) {
      await rm(join(target, name), { recursive: true, force: true })
    }
    for (const name of previousNames.reverse()) {
      await rename(join(previous, name), join(target, name))
    }
    await rm(previous, { recursive: true, force: true })
    throw error
  }
}

function capabilityView(capability: HubCapability): HubCapabilityView {
  return {
    id: capability.id,
    type: capability.type,
    externalRef: capability.externalRef,
    name: capability.name,
    ...capability.description === undefined ? {} : { description: capability.description },
    releaseVersion: capability.releaseVersion,
    ...capability.integrityHash === undefined ? {} : { integrityHash: capability.integrityHash },
  }
}

function validateDesktopRelease(value: unknown, expectedPlatform: HubDesktopReleasePlatform): HubDesktopRelease {
  if (typeof value !== 'object' || value === null) {
    throw new AiHubError('INVALID_DESKTOP_RELEASE', 'AI Hub 返回了无效的客户端版本信息')
  }
  const release = value as Record<string, unknown>
  if (typeof release.id !== 'string' || release.id.length === 0
    || typeof release.version !== 'string' || release.version.length === 0
    || release.platform !== expectedPlatform
    || release.status !== 'PUBLISHED'
    || typeof release.fileName !== 'string'
    || !Number.isSafeInteger(release.sizeBytes) || Number(release.sizeBytes) <= 0
    || Number(release.sizeBytes) > MAX_DESKTOP_RELEASE_BYTES
    || typeof release.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(release.sha256)
    || typeof release.releaseNotes !== 'string' || release.releaseNotes.trim().length === 0) {
    throw new AiHubError('INVALID_DESKTOP_RELEASE', 'AI Hub 返回了无效的客户端版本信息')
  }
  desktopReleaseExtension(release.fileName, expectedPlatform)
  return release as unknown as HubDesktopRelease
}

function desktopReleaseExtension(fileName: string, platform: HubDesktopReleasePlatform): string {
  const extension = extname(fileName).toLowerCase()
  const accepted = platform === 'WINDOWS_X64'
    ? extension === '.exe'
    : extension === '.dmg' || extension === '.pkg'
  if (!accepted) throw new AiHubError('INVALID_DESKTOP_RELEASE', '客户端安装制品格式与目标平台不匹配')
  return extension
}

async function extractSkillZip(content: Uint8Array, destination: string): Promise<void> {
  const entries = new Map<string, Uint8Array>()
  let entryCount = 0
  let totalBytes = 0
  let failure: Error | undefined
  const unzip = new Unzip((file) => {
    const path = normalizeArchivePath(file.name)
    entryCount += 1
    if (entryCount > MAX_SKILL_ENTRIES) failure ??= new Error('Skill 压缩包文件数量超过限制')
    const chunks: Uint8Array[] = []
    let fileBytes = 0
    file.ondata = (error, chunk, final) => {
      if (error !== null) failure ??= error
      if (failure !== undefined) return
      totalBytes += chunk.byteLength
      fileBytes += chunk.byteLength
      if (totalBytes > MAX_SKILL_UNCOMPRESSED_BYTES) {
        failure = new Error('Skill 压缩包解压后超过 8 MiB')
        return
      }
      chunks.push(chunk)
      if (final && !path.endsWith('/')) entries.set(path, concatenate(chunks, fileBytes))
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    unzip.push(content, true)
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error))
  }
  if (failure !== undefined) throw new AiHubError('INVALID_SKILL_ARCHIVE', failure.message)
  const definitions = [...entries.keys()].filter(path => path === 'SKILL.md' || /^[^/]+\/SKILL\.md$/.test(path))
  const [definition] = definitions
  if (definition === undefined || definitions.length !== 1) {
    throw new AiHubError('INVALID_SKILL_ARCHIVE', 'Skill 压缩包必须包含一个顶层 SKILL.md')
  }
  const prefix = definition === 'SKILL.md' ? '' : definition.slice(0, definition.indexOf('/') + 1)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const [path, bytes] of entries) {
    if (prefix !== '' && !path.startsWith(prefix)) continue
    const relative = prefix === '' ? path : path.slice(prefix.length)
    if (relative.length === 0) continue
    const target = join(destination, ...relative.split('/'))
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { mode: 0o600 })
  }
}

interface PluginManifest {
  schemaVersion: number
  id: string
  name: string
  description: string
  version: string
  entry: string
  activation: string
  skills?: Array<{ name: string; path: string }>
}

interface InstalledPlugin {
  capabilityId: string
  id: string
  entry: string
  version: string
}

interface ManagedInstruction {
  capability: HubCapability
  markdown: string
}

function renderManagedInstructionFile(instructions: readonly ManagedInstruction[]): string {
  const sections = instructions
    .toSorted((left, right) => left.capability.externalRef.localeCompare(right.capability.externalRef, 'en'))
    .flatMap(({ capability, markdown }) => [
      `## ${capability.name}`,
      '',
      `Managed source: ${capability.externalRef}@${capability.releaseVersion}`,
      '',
      markdown.trim(),
      '',
    ])
  return [
    '# Enterprise Managed AGENTS.md',
    '',
    'This file is generated by AI Hub. Local edits are not permitted and will be replaced during reconciliation.',
    '',
    ...sections,
  ].join('\n').trimEnd() + '\n'
}

async function extractPluginZip(
  content: Uint8Array,
  capability: HubCapability,
  destination: string,
  skillRoot: string,
): Promise<InstalledPlugin> {
  const entries = archiveEntries(content, MAX_PLUGIN_ENTRIES, MAX_PLUGIN_UNCOMPRESSED_BYTES, 'INVALID_PLUGIN_ARCHIVE')
  const manifestBytes = entries.get('plugin.json')
  if (manifestBytes === undefined) throw new AiHubError('INVALID_PLUGIN_ARCHIVE', '插件压缩包缺少顶层 plugin.json')
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as PluginManifest
  } catch {
    throw new AiHubError('INVALID_PLUGIN_MANIFEST', 'plugin.json 不是有效的 UTF-8 JSON')
  }
  if (manifest.schemaVersion !== 1
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)
    || manifest.id !== capability.externalRef
    || manifest.version !== capability.releaseVersion
    || typeof manifest.name !== 'string'
    || typeof manifest.description !== 'string'
    || typeof manifest.entry !== 'string'
    || manifest.activation !== 'hot') {
    throw new AiHubError('INVALID_PLUGIN_MANIFEST', 'plugin.json 与 AI Hub 发布元数据不一致')
  }
  const entry = normalizeArchivePath(manifest.entry, 'INVALID_PLUGIN_ARCHIVE')
  if (!entry.endsWith('.mjs') || !entries.has(entry)) {
    throw new AiHubError('INVALID_PLUGIN_ENTRY', '插件入口必须是压缩包内存在的 .mjs 文件')
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const [path, bytes] of entries) {
    const target = join(destination, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { mode: 0o600 })
  }
  for (const bundledSkill of manifest.skills ?? []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bundledSkill.name)) {
      throw new AiHubError('INVALID_PLUGIN_MANIFEST', '插件内 Skill name 必须为 kebab-case')
    }
    const skillPath = normalizeArchivePath(bundledSkill.path, 'INVALID_PLUGIN_ARCHIVE').replace(/\/$/, '')
    const prefix = `${skillPath}/`
    if (!entries.has(`${prefix}SKILL.md`)) {
      throw new AiHubError('INVALID_PLUGIN_MANIFEST', `插件内 Skill ${bundledSkill.name} 缺少 SKILL.md`)
    }
    const skillDestination = join(skillRoot, `plugin-${manifest.id}-${bundledSkill.name}`)
    for (const [path, bytes] of entries) {
      if (!path.startsWith(prefix)) continue
      const relative = path.slice(prefix.length)
      if (relative.length === 0) continue
      const target = join(skillDestination, ...relative.split('/'))
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, bytes, { mode: 0o600 })
    }
  }
  return { capabilityId: capability.id, id: manifest.id, entry, version: manifest.version }
}

function archiveEntries(
  content: Uint8Array,
  maxEntries: number,
  maxBytes: number,
  errorCode: string,
): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  let entryCount = 0
  let totalBytes = 0
  let failure: Error | undefined
  const unzip = new Unzip((file) => {
    const path = normalizeArchivePath(file.name, errorCode)
    entryCount += 1
    if (entryCount > maxEntries) failure ??= new Error('插件压缩包文件数量超过限制')
    const chunks: Uint8Array[] = []
    let fileBytes = 0
    file.ondata = (error, chunk, final) => {
      if (error !== null) failure ??= error
      if (failure !== undefined) return
      totalBytes += chunk.byteLength
      fileBytes += chunk.byteLength
      if (totalBytes > maxBytes) {
        failure = new Error('插件压缩包解压后超过 80 MiB')
        return
      }
      chunks.push(chunk)
      if (final && !path.endsWith('/')) {
        if (entries.has(path)) failure = new Error('插件压缩包包含重复路径')
        else entries.set(path, concatenate(chunks, fileBytes))
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    unzip.push(content, true)
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error))
  }
  if (failure !== undefined) throw new AiHubError(errorCode, failure.message)
  return entries
}

async function writeManagedPluginPatch(
  path: string,
  pluginRoot: string,
  plugins: readonly InstalledPlugin[],
): Promise<string> {
  const rows = plugins.length === 0 ? [] : [{
    insert: plugins.map(plugin => ({
      id: `hub-client-plugin-${plugin.capabilityId}`,
      name: `${pathToFileURL(join(pluginRoot, plugin.capabilityId, ...plugin.entry.split('/'))).href}?managed=${encodeURIComponent(plugin.version)}`,
    })),
  }]
  const content = stringifyYaml(rows)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const stage = `${path}.tmp-${randomUUID()}`
  await writeFile(stage, content, { encoding: 'utf8', mode: 0o600 })
  await rename(stage, path)
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

async function fileSha256(path: string): Promise<string | undefined> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function copyBundledPluginSkills(sourceRoot: string, destinationRoot: string): Promise<void> {
  let entries
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('plugin-')) continue
    await cp(join(sourceRoot, entry.name), join(destinationRoot, entry.name), { recursive: true, force: true })
  }
}

function normalizeArchivePath(raw: string, errorCode = 'INVALID_SKILL_ARCHIVE'): string {
  const path = raw.replaceAll('\\', '/')
  if (path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    throw new AiHubError(errorCode, '压缩包包含不安全路径')
  }
  const normalized = posix.normalize(path)
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new AiHubError(errorCode, '压缩包包含不安全路径')
  }
  return normalized
}

function concatenate(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
