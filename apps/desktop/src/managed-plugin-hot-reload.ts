import { readFile } from 'node:fs/promises'

interface ManagedPluginHotReloadStatus {
  revision: string
  ok: boolean
  error?: string
}

function parseStatus(raw: string): ManagedPluginHotReloadStatus | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const status = value as { revision?: unknown; ok?: unknown; error?: unknown }
  if (typeof status.revision !== 'string' || !/^[0-9a-f]{64}$/.test(status.revision)
    || typeof status.ok !== 'boolean') return undefined
  return {
    revision: status.revision,
    ok: status.ok,
    ...(typeof status.error === 'string' ? { error: status.error } : {}),
  }
}

async function readStatus(path: string): Promise<ManagedPluginHotReloadStatus | undefined> {
  try {
    return parseStatus(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Wait until the Host transactionally commits or rejects one managed plug-in Patch revision. */
export async function waitForManagedPluginHotReload(
  statusPath: string,
  revision: string,
  timeoutMs = 30_000,
  pollMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await readStatus(statusPath)
    if (status?.revision === revision) {
      if (status.ok) return
      throw new Error(`受管插件热更新失败: ${status.error ?? 'Host 拒绝了候选版本'}`)
    }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  throw new Error('受管插件热更新确认超时')
}
