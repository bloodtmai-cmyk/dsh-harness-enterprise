import { constants } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface CredentialCipher {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

interface StoredCredential {
  version: 2
  workcode: string
  applicationId: string
  apiKey: string
}

export async function migrateManagedModelCredential(
  filePath: string,
  legacyFilePaths: string[],
): Promise<string | undefined> {
  for (const legacyFilePath of legacyFilePaths) {
    if (legacyFilePath === filePath) continue
    try {
      await mkdir(dirname(filePath), { recursive: true })
      await copyFile(legacyFilePath, filePath, constants.COPYFILE_EXCL)
      await chmod(filePath, 0o600).catch(() => undefined)
      return legacyFilePath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') return undefined
      if (code === 'ENOENT') continue
    }
  }
  return undefined
}

export class ManagedModelCredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: CredentialCipher,
  ) {}

  async load(workcode: string, applicationId: string): Promise<string | undefined> {
    if (!this.cipher.isEncryptionAvailable()) return undefined
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      return undefined
    }

    try {
      const parsed = JSON.parse(this.cipher.decryptString(encrypted)) as {
        version?: unknown
        workcode?: unknown
        applicationId?: unknown
        apiKey?: unknown
      }
      if (parsed.version === 1
        && typeof parsed.workcode === 'string'
        && typeof parsed.apiKey === 'string') {
        if (parsed.workcode.toLowerCase() !== workcode.toLowerCase() || parsed.apiKey.length === 0) return undefined
        await this.save(workcode, applicationId, parsed.apiKey)
        return parsed.apiKey
      }
      if (parsed.version !== 2
        || typeof parsed.workcode !== 'string'
        || typeof parsed.applicationId !== 'string'
        || typeof parsed.apiKey !== 'string') {
        await this.clear()
        return undefined
      }
      if (parsed.workcode.toLowerCase() !== workcode.toLowerCase()
        || parsed.applicationId !== applicationId
        || parsed.apiKey.length === 0) return undefined
      return parsed.apiKey
    } catch {
      await this.clear()
      return undefined
    }
  }

  async save(workcode: string, applicationId: string, apiKey: string): Promise<boolean> {
    if (!this.cipher.isEncryptionAvailable()) return false
    try {
      const payload: StoredCredential = { version: 2, workcode, applicationId, apiKey }
      const encrypted = this.cipher.encryptString(JSON.stringify(payload))
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(temporaryPath, encrypted, { mode: 0o600 })
      await rm(this.filePath, { force: true })
      await rename(temporaryPath, this.filePath)
      return true
    } catch {
      return false
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true }).catch(() => undefined)
  }
}
