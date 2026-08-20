import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  AiHubClient,
  catalogActivationChanges,
  catalogVersionChanges,
  catalogRevisions,
  deferRestartBoundCatalog,
  desktopReleasePlatform,
  isCatalogVersionOnlyChange,
  resolveManagedPluginRoot,
} from '../src/ai-hub-client.ts'
import type { HubCapability, HubCatalog, HubDesktopRelease } from '../src/ai-hub-client.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('AI Hub desktop client', () => {
  it('places managed plug-ins beneath the profile module fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-plugin-resolution-'))
    tempRoots.push(root)
    const harnessHome = join(root, 'harness-home')
    const pluginRoot = resolveManagedPluginRoot(harnessHome)
    const sdkRoot = join(harnessHome, 'profiles', 'node_modules', '@fixture', 'platform-sdk')
    const pluginEntry = join(pluginRoot, 'agent-reach', 'index.mjs')
    await mkdir(sdkRoot, { recursive: true })
    await mkdir(join(pluginRoot, 'agent-reach'), { recursive: true })
    await writeFile(join(sdkRoot, 'package.json'), JSON.stringify({
      name: '@fixture/platform-sdk',
      type: 'module',
      exports: './index.mjs',
    }))
    await writeFile(join(sdkRoot, 'index.mjs'), "export const marker = 'resolved-through-profile-fallback'\n")
    await writeFile(pluginEntry, "import { marker } from '@fixture/platform-sdk'\nexport default marker\n")

    const loaded = await import(`${pathToFileURL(pluginEntry).href}?test=${randomUUID()}`) as { default: string }

    expect(pluginRoot).toBe(join(harnessHome, 'profiles', 'hub-plugins'))
    expect(loaded.default).toBe('resolved-through-profile-fallback')
  })

  it('maps only supported desktop targets to the Hub release contract', () => {
    expect(desktopReleasePlatform('darwin', 'arm64')).toBe('MAC_ARM64')
    expect(desktopReleasePlatform('darwin', 'x64')).toBe('MAC_X64')
    expect(desktopReleasePlatform('win32', 'x64')).toBe('WINDOWS_X64')
    expect(desktopReleasePlatform('linux', 'x64')).toBeUndefined()
    expect(desktopReleasePlatform('win32', 'arm64')).toBeUndefined()
  })

  it('checks whether AI Hub has a newer published desktop release', async () => {
    const release = {
      id: 'release-1',
      version: '0.1.0-rc.18',
      platform: 'MAC_ARM64',
      status: 'PUBLISHED',
      fileName: 'DSH-Harness-0.1.0-rc.18-arm64.dmg',
      sizeBytes: 128,
      sha256: 'a'.repeat(64),
      releaseNotes: '可选升级测试版本',
    } satisfies HubDesktopRelease
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(release))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)

    await expect(client.latestDesktopRelease('MAC_ARM64', '0.1.0-rc.17')).resolves.toEqual(release)
    await expect(client.latestDesktopRelease('MAC_ARM64', '0.1.0-rc.18')).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://hub.example/ai-hub/api/client/desktop-releases/latest?platform=MAC_ARM64&currentVersion=0.1.0-rc.17',
    )
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toBeInstanceOf(Headers)
  })

  it('downloads a desktop release only after its size and SHA-256 match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-release-'))
    tempRoots.push(root)
    const content = new TextEncoder().encode('verified desktop installer')
    const release = {
      id: 'release-verified',
      version: '0.1.0-rc.18',
      platform: 'MAC_ARM64',
      status: 'PUBLISHED',
      fileName: 'DSH-Harness-0.1.0-rc.18-arm64.dmg',
      sizeBytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
      releaseNotes: '可选升级测试版本',
    } satisfies HubDesktopRelease
    const progress = vi.fn()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(content, {
      headers: { 'Content-Length': String(content.byteLength) },
    }))
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)

    const target = await client.downloadDesktopRelease(release, root, progress)

    await expect(readFile(target)).resolves.toEqual(Buffer.from(content))
    expect(progress).toHaveBeenLastCalledWith(1)
    expect(await readdir(root)).toEqual(['release-verified.dmg'])
  })

  it('removes a staged desktop release when integrity verification fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-release-invalid-'))
    tempRoots.push(root)
    const content = new TextEncoder().encode('tampered desktop installer')
    const release = {
      id: 'release-invalid',
      version: '0.1.0-rc.18',
      platform: 'MAC_ARM64',
      status: 'PUBLISHED',
      fileName: 'DSH-Harness-0.1.0-rc.18-arm64.dmg',
      sizeBytes: content.byteLength,
      sha256: '0'.repeat(64),
      releaseNotes: '可选升级测试版本',
    } satisfies HubDesktopRelease
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(content)))

    await expect(client.downloadDesktopRelease(release, root)).rejects.toMatchObject({
      code: 'DESKTOP_RELEASE_INTEGRITY_MISMATCH',
    })
    expect(await readdir(root)).toEqual([])
  })

  it('separates hot-loaded plug-in, Skill, and instruction revisions', () => {
    const instruction = {
      id: 'instruction-1', type: 'INSTRUCTION', externalRef: 'enterprise-baseline',
      name: '企业安全基线', releaseVersion: '1.0.0', integrityHash: 'a'.repeat(64),
    } satisfies HubCapability
    const skill = {
      id: 'skill-1', type: 'SKILL', externalRef: 'stock-report',
      name: 'Stock Report', releaseVersion: '1.0.0', integrityHash: 'c'.repeat(64),
    } satisfies HubCapability
    const base = {
      mcps: [], skills: [skill], bundles: [], plugins: [],
      instructions: [instruction],
      evaluatedAt: '2026-08-17T10:00:00Z',
    } satisfies HubCatalog
    const updatedInstruction = {
      ...base,
      instructions: [{ ...instruction, releaseVersion: '1.1.0', integrityHash: 'b'.repeat(64) }],
    } satisfies HubCatalog
    const addedPlugin = {
      ...base,
      plugins: [{
        id: 'plugin-1', type: 'CLIENT_PLUGIN', externalRef: 'agent-reach',
        name: 'Agent Reach', releaseVersion: '1.0.0',
      }],
    } satisfies HubCatalog
    const updatedSkill = {
      ...base,
      skills: [{ ...skill, id: 'skill-2', releaseVersion: '1.1.0', integrityHash: 'd'.repeat(64) }],
    } satisfies HubCatalog

    expect(catalogRevisions(updatedInstruction).activation).toBe(catalogRevisions(base).activation)
    expect(catalogRevisions(updatedInstruction).skills).toBe(catalogRevisions(base).skills)
    expect(catalogRevisions(updatedInstruction).instructions).not.toBe(catalogRevisions(base).instructions)
    expect(catalogRevisions(updatedSkill).activation).toBe(catalogRevisions(base).activation)
    expect(catalogRevisions(updatedSkill).skills).not.toBe(catalogRevisions(base).skills)
    expect(catalogRevisions(updatedSkill).instructions).toBe(catalogRevisions(base).instructions)
    expect(catalogRevisions(addedPlugin).activation).not.toBe(catalogRevisions(base).activation)
    expect(catalogRevisions(addedPlugin).skills).toBe(catalogRevisions(base).skills)
    expect(catalogRevisions(addedPlugin).instructions).toBe(catalogRevisions(base).instructions)
  })

  it('distinguishes hot plug-in generations from Skill and Gateway catalog changes', () => {
    const pluginV1 = {
      id: 'plugin-v1', type: 'CLIENT_PLUGIN', externalRef: 'agent-reach',
      name: 'Agent Reach', releaseVersion: '1.5.0-dsh.1',
    } satisfies HubCapability
    const skillV1 = {
      id: 'skill-v1', type: 'SKILL', externalRef: 'stock-report',
      name: 'Stock Report', releaseVersion: '1.0.0',
    } satisfies HubCapability
    const mcpV1 = {
      id: 'mcp-v1', type: 'MCP', externalRef: 'workbuddy',
      name: 'WorkBuddy', releaseVersion: '2.0.0',
    } satisfies HubCapability
    const current = {
      mcps: [{ mcp: mcpV1, tools: [] }], skills: [skillV1], bundles: [],
      instructions: [], evaluatedAt: '2026-08-18T08:00:00Z',
      plugins: [pluginV1],
    } satisfies HubCatalog
    const upgraded = {
      ...current,
      mcps: [{ mcp: { ...mcpV1, id: 'mcp-v2', releaseVersion: '2.1.0' }, tools: [] }],
      skills: [{ ...skillV1, id: 'skill-v2', releaseVersion: '1.1.0' }],
      plugins: [{
        ...pluginV1, id: 'plugin-v2', releaseVersion: '1.5.0-dsh.2',
      }],
    } satisfies HubCatalog
    const granted = {
      ...upgraded,
      plugins: [...upgraded.plugins, {
        id: 'plugin-memory', type: 'CLIENT_PLUGIN', externalRef: 'memory-helper',
        name: 'Memory Helper', releaseVersion: '1.0.0',
      }],
    } satisfies HubCatalog
    const skillOnlyUpgrade = {
      ...current,
      skills: upgraded.skills,
    } satisfies HubCatalog

    expect(catalogVersionChanges(current, upgraded)).toEqual([
      {
        type: 'CLIENT_PLUGIN', externalRef: 'agent-reach', name: 'Agent Reach',
        fromVersion: '1.5.0-dsh.1', toVersion: '1.5.0-dsh.2',
      },
    ])
    expect(catalogRevisions(upgraded).skills).not.toBe(catalogRevisions(current).skills)
    expect(catalogVersionChanges(current, skillOnlyUpgrade)).toEqual([])
    expect(isCatalogVersionOnlyChange(current, skillOnlyUpgrade)).toBe(false)
    expect(isCatalogVersionOnlyChange(current, upgraded)).toBe(true)
    expect(isCatalogVersionOnlyChange(current, granted)).toBe(false)
    expect(catalogActivationChanges(current, granted)).toEqual([
      {
        action: 'UPDATED', type: 'CLIENT_PLUGIN', externalRef: 'agent-reach', name: 'Agent Reach',
        fromVersion: '1.5.0-dsh.1', toVersion: '1.5.0-dsh.2',
      },
      {
        action: 'GRANTED', type: 'CLIENT_PLUGIN', externalRef: 'memory-helper', name: 'Memory Helper',
        fromVersion: '', toVersion: '1.0.0',
      },
    ])
    expect(catalogActivationChanges(granted, current)).toContainEqual({
      action: 'REVOKED', type: 'CLIENT_PLUGIN', externalRef: 'memory-helper', name: 'Memory Helper',
      fromVersion: '1.0.0', toVersion: '',
    })

    const deferred = deferRestartBoundCatalog(current, granted)
    expect(deferred.mcps).toBe(granted.mcps)
    expect(deferred.plugins).toBe(current.plugins)
    expect(deferred.skills).toBe(granted.skills)
    expect(deferred.instructions).toBe(granted.instructions)
  })

  it('tracks MCP tool replacements as a live Gateway catalog change', () => {
    const mcp = {
      id: 'mcp-1', type: 'MCP', externalRef: 'workbuddy',
      name: 'WorkBuddy', releaseVersion: '2.0.0',
    } satisfies HubCapability
    const tool = {
      id: 'tool-v1', type: 'TOOL', externalRef: 'stock-query',
      name: 'Stock Query', releaseVersion: '1.0.0',
    } satisfies HubCapability
    const current = {
      mcps: [{ mcp, tools: [tool] }], skills: [], bundles: [], plugins: [], instructions: [],
      evaluatedAt: '2026-08-18T08:00:00Z',
    } satisfies HubCatalog
    const upgraded = {
      ...current,
      mcps: [{ mcp, tools: [{ ...tool, id: 'tool-v2', releaseVersion: '1.1.0' }] }],
    } satisfies HubCatalog

    expect(catalogVersionChanges(current, upgraded)).toEqual([])
    expect(isCatalogVersionOnlyChange(current, upgraded)).toBe(false)
    expect(catalogRevisions(current).activation).toBe(catalogRevisions(upgraded).activation)
    expect(catalogRevisions(current).gateway).not.toBe(catalogRevisions(upgraded).gateway)
  })

  it('claims an approved key once through the Hub API', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{ id: 'request-1', status: 'APPROVED', keyStatus: 'AVAILABLE' }]))
      .mockResolvedValueOnce(Response.json({
        apiKey: 'sk-issued', provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1',
      }))
    const client = new AiHubClient('https://hub.example/ai-hub/', 'oauth-token', fetchImpl)

    await expect(client.resolveKey()).resolves.toEqual({
      state: 'claimed',
      applicationId: 'request-1',
      key: { apiKey: 'sk-issued', provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1' },
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      'https://hub.example/ai-hub/api/client/key-applications/request-1/secret:claim',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer oauth-token')
  })

  it('requires an active Hub application before a locally cached key can be considered', async () => {
    const pending = new AiHubClient('https://hub.example/ai-hub', 'oauth-token',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ id: 'request-1', status: 'PENDING' }])))
    const revoked = new AiHubClient('https://hub.example/ai-hub', 'oauth-token',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json([{
        id: 'request-2', status: 'APPROVED', keyStatus: 'REVOKED', claimedAt: '2026-08-18T08:00:00Z',
      }])))
    const claimed = new AiHubClient('https://hub.example/ai-hub', 'oauth-token',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json([{
        id: 'request-3', status: 'APPROVED', keyStatus: 'CLAIMED', claimedAt: '2026-08-18T08:00:00Z',
        provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1',
      }])))

    await expect(pending.resolveKey()).resolves.toEqual({ state: 'pending' })
    await expect(revoked.resolveKey()).resolves.toMatchObject({ state: 'application-required' })
    await expect(claimed.resolveKey()).resolves.toEqual({
      state: 'claimed-elsewhere',
      applicationId: 'request-3',
      provider: 'openai-compatible',
      baseUrl: 'https://models.example.com/v1',
    })
  })

  it('fails closed when a legacy Hub binding has no model endpoint metadata', async () => {
    const claimedWithoutEndpoint = new AiHubClient('https://hub.example/ai-hub', 'oauth-token',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json([{
        id: 'request-legacy', status: 'APPROVED', keyStatus: 'CLAIMED',
        claimedAt: '2026-08-18T08:00:00Z', provider: null, baseUrl: null,
      }])))

    await expect(claimedWithoutEndpoint.resolveKey()).resolves.toEqual({
      state: 'application-required',
      message: '模型访问地址尚未配置，请联系管理员。',
    })
  })

  it('returns the existing pending application when an application request is idempotent', async () => {
    const application = { id: 'request-1', status: 'PENDING' as const }
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(application))
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)

    await expect(client.applyForKey(['deepseek-v4-flash'])).resolves.toEqual(application)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/ai-hub/api/client/key-applications',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('installs only Hub-authorized skills and enables WorkBuddy when a tool is exposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-client-'))
    tempRoots.push(root)
    const skill = new TextEncoder().encode('# stock-check\n')
    const integrityHash = createHash('sha256').update(skill).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/api/client/catalog')) {
        return Response.json({
          mcps: [{
            mcp: { id: 'mcp-1', type: 'MCP', externalRef: 'workbuddy', name: 'WorkBuddy', releaseVersion: '1.0.0' },
            tools: [{ id: 'tool-1', type: 'TOOL', externalRef: 'workbuddy/check', name: '库存查询', releaseVersion: '1.0.0' }],
          }],
          skills: [{
            id: 'skill-1', type: 'SKILL', externalRef: 'stock-check', name: '库存助手',
            releaseVersion: '1.0.0', integrityHash,
          }],
          bundles: [{
            bundle: { id: 'bundle-1', type: 'BUNDLE', externalRef: 'stock-suite', name: '库存套件', releaseVersion: '1.0.0' },
            members: [{ id: 'skill-1', type: 'SKILL', externalRef: 'stock-check', name: '库存助手', releaseVersion: '1.0.0' }],
          }],
          evaluatedAt: '2026-08-17T08:00:00Z',
        })
      }
      return new Response(skill, { headers: { 'Content-Type': 'text/markdown' } })
    })
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)

    await expect(client.synchronizeCatalog(join(root, 'skills'))).resolves.toMatchObject({
      workBuddyEnabled: true,
      skillCount: 1,
      pluginCount: 0,
      instructionCount: 0,
      pluginPatchRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshot: {
        available: true,
        mcps: [{
          mcp: { id: 'mcp-1', type: 'MCP', externalRef: 'workbuddy', name: 'WorkBuddy', releaseVersion: '1.0.0' },
          tools: [{ id: 'tool-1', type: 'TOOL', externalRef: 'workbuddy/check', name: '库存查询', releaseVersion: '1.0.0' }],
        }],
        skills: [{
          id: 'skill-1', type: 'SKILL', externalRef: 'stock-check', name: '库存助手',
          releaseVersion: '1.0.0', integrityHash,
        }],
        bundles: [{
          bundle: { id: 'bundle-1', type: 'BUNDLE', externalRef: 'stock-suite', name: '库存套件', releaseVersion: '1.0.0' },
          members: [{ id: 'skill-1', type: 'SKILL', externalRef: 'stock-check', name: '库存助手', releaseVersion: '1.0.0' }],
        }],
        plugins: [],
        instructions: [],
        evaluatedAt: '2026-08-17T08:00:00Z',
      },
    })
    await expect(readFile(join(root, 'skills', 'stock-check.md'), 'utf8')).resolves.toBe('# stock-check\n')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('preserves the watched Skill root during a hot authorization update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-skill-hot-'))
    tempRoots.push(root)
    const skills = join(root, 'hub-skills')
    const content = new TextEncoder().encode('---\nname: wecom-unified\ndescription: WeCom.\n---\n')
    const integrityHash = createHash('sha256').update(content).digest('hex')
    const catalog: HubCatalog = {
      mcps: [], bundles: [], plugins: [], instructions: [],
      skills: [{
        id: 'skill-wecom', type: 'SKILL', externalRef: 'wecom-unified', name: '企业微信办公套件',
        releaseVersion: '1.1.0', integrityHash,
      }],
      evaluatedAt: '2026-08-18T10:00:00Z',
    }
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', vi.fn<typeof fetch>(async () =>
      new Response(content, { headers: { 'Content-Type': 'text/markdown' } })))
    await mkdir(skills, { recursive: true })
    await writeFile(join(skills, 'old.md'), 'old')
    const before = await stat(skills)

    await client.synchronizeCatalog(
      skills,
      join(root, 'plugins'),
      join(root, 'plugins.patch.yml'),
      join(root, 'instructions'),
      catalog,
      { preserveSkillRoot: true },
    )

    await expect(readFile(join(skills, 'wecom-unified.md'), 'utf8')).resolves.toContain('wecom-unified')
    await expect(readFile(join(skills, 'old.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform !== 'win32') expect((await stat(skills)).ino).toBe(before.ino)
  })

  it('updates hot content without downloading a superseded active plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-hot-content-'))
    tempRoots.push(root)
    const skills = join(root, 'hub-skills')
    const plugins = join(root, 'hub-plugins')
    const patch = join(root, 'hub-plugins.patch.yml')
    const instructions = join(root, 'hub-instructions')
    const bundledSkill = join(skills, 'plugin-agent-reach-agent-reach')
    await mkdir(bundledSkill, { recursive: true })
    await writeFile(join(bundledSkill, 'SKILL.md'), '# installed plugin skill\n')
    await mkdir(join(plugins, 'old-plugin-id'), { recursive: true })
    await writeFile(join(plugins, 'old-plugin-id', 'index.mjs'), 'export function apply() {}\n')
    await writeFile(patch, '- insert: []\n')
    const beforePatch = await readFile(patch, 'utf8')
    const catalog: HubCatalog = {
      mcps: [], skills: [], bundles: [], instructions: [],
      plugins: [{
        id: 'old-plugin-id', type: 'CLIENT_PLUGIN', externalRef: 'agent-reach', name: 'Agent Reach',
        releaseVersion: '1.5.0-dsh.2', integrityHash: 'unavailable-old-artifact',
      }],
      evaluatedAt: '2026-08-19T06:00:00Z',
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('superseded plugin artifact must not be requested')
    })
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)

    const result = await client.synchronizeCatalog(
      skills,
      plugins,
      patch,
      instructions,
      catalog,
      { preserveSkillRoot: true, preservePluginRoot: true },
    )

    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(readFile(join(plugins, 'old-plugin-id', 'index.mjs'), 'utf8')).resolves.toContain('apply')
    await expect(readFile(join(bundledSkill, 'SKILL.md'), 'utf8')).resolves.toContain('installed plugin skill')
    await expect(readFile(patch, 'utf8')).resolves.toBe(beforePatch)
    expect(result.pluginCount).toBe(1)
    expect(result.pluginPatchRevision).toBe(createHash('sha256').update(beforePatch).digest('hex'))
  })

  it('downloads authorized enterprise instructions as one read-only AGENTS.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-instruction-'))
    tempRoots.push(root)
    const instruction = new TextEncoder().encode('# Enterprise baseline\n\nUse approved tools only.\n')
    const integrityHash = createHash('sha256').update(instruction).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/api/client/catalog')) {
        return Response.json({
          mcps: [], skills: [], bundles: [], plugins: [],
          instructions: [{
            id: 'instruction-1', type: 'INSTRUCTION', externalRef: 'enterprise-baseline',
            name: '企业安全基线', releaseVersion: '1.0.0', integrityHash,
          }],
          evaluatedAt: '2026-08-17T10:00:00Z',
        })
      }
      return new Response(instruction, { headers: { 'Content-Type': 'text/markdown' } })
    })
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)

    const result = await client.synchronizeCatalog(join(root, 'skills'))

    expect(result.instructionCount).toBe(1)
    expect(result.managedInstructionFile).toBe(join(root, 'hub-instructions', 'AGENTS.md'))
    expect(result.managedInstructionHashFile).toBe(join(root, 'hub-instructions', 'AGENTS.sha256'))
    await expect(readFile(result.managedInstructionFile!, 'utf8')).resolves.toContain('enterprise-baseline@1.0.0')
    await expect(readFile(result.managedInstructionHashFile!, 'utf8')).resolves.toMatch(/^[0-9a-f]{64}\n$/)
    if (process.platform !== 'win32') {
      expect((await stat(result.managedInstructionFile!)).mode & 0o222).toBe(0)
      expect((await stat(result.managedInstructionHashFile!)).mode & 0o222).toBe(0)
    }
  })

  it('verifies and installs an authorized client plugin with its bundled Skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-hub-plugin-'))
    tempRoots.push(root)
    const plugin = zipSync({
      'plugin.json': strToU8(JSON.stringify({
        schemaVersion: 1,
        id: 'agent-reach',
        name: 'Agent Reach',
        description: 'Managed research plugin',
        version: '1.5.0-dsh.1',
        entry: 'index.mjs',
        activation: 'hot',
        skills: [{ name: 'agent-reach', path: 'skills/agent-reach' }],
      })),
      'index.mjs': strToU8('export function apply() {}\n'),
      'skills/agent-reach/SKILL.md': strToU8('---\nname: agent-reach\ndescription: Managed research.\n---\n'),
    })
    const integrityHash = createHash('sha256').update(plugin).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/api/client/catalog')) {
        return Response.json({
          mcps: [], skills: [], bundles: [],
          plugins: [{
            id: 'plugin-1', type: 'CLIENT_PLUGIN', externalRef: 'agent-reach', name: 'Agent Reach',
            releaseVersion: '1.5.0-dsh.1', integrityHash,
          }],
          evaluatedAt: '2026-08-17T09:00:00Z',
        })
      }
      return new Response(plugin, { headers: { 'Content-Type': 'application/zip' } })
    })
    const client = new AiHubClient('https://hub.example/ai-hub', 'oauth-token', fetchImpl)
    const skills = join(root, 'skills')
    const plugins = join(root, 'plugins')
    const patch = join(root, 'plugins.patch.yml')

    const result = await client.synchronizeCatalog(skills, plugins, patch)

    expect(result.pluginCount).toBe(1)
    await expect(readFile(join(plugins, 'plugin-1', 'index.mjs'), 'utf8')).resolves.toContain('apply')
    await expect(readFile(join(skills, 'plugin-agent-reach-agent-reach', 'SKILL.md'), 'utf8')).resolves.toContain('agent-reach')
    await expect(readFile(patch, 'utf8')).resolves.toContain('hub-client-plugin-plugin-1')
    await expect(readFile(patch, 'utf8')).resolves.toContain('?managed=1.5.0-dsh.1')
    expect(result.pluginPatchRevision).toMatch(/^[0-9a-f]{64}$/)
  })
})
