import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagedModelCredentialStore, migrateManagedModelCredential } from '../src/credential-store.ts'

const temporaryDirectories: string[] = []
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(Buffer.from(value, 'utf8').map(byte => byte ^ 0xA5)),
  decryptString: (value: Buffer) => Buffer.from(value.map(byte => byte ^ 0xA5)).toString('utf8'),
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ file: string; store: ManagedModelCredentialStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-credential-'))
  temporaryDirectories.push(directory)
  const file = join(directory, 'managed-model-key.bin')
  return { file, store: new ManagedModelCredentialStore(file, cipher) }
}

describe('managed model credential store', () => {
  it('encrypts the key and binds it to the authenticated workcode', async () => {
    const { file, store } = await fixture()

    await expect(store.save('001234', 'application-1', 'sk-sensitive')).resolves.toBe(true)
    await expect(store.load('001234', 'application-1')).resolves.toBe('sk-sensitive')
    await expect(store.load('001234', 'application-2')).resolves.toBeUndefined()
    await expect(store.load('009999', 'application-1')).resolves.toBeUndefined()
    expect((await readFile(file)).includes(Buffer.from('sk-sensitive'))).toBe(false)
  })

  it('removes an unreadable encrypted credential', async () => {
    const { file, store } = await fixture()
    await writeFile(file, 'not-an-encrypted-json-record')

    await expect(store.load('001234', 'application-1')).resolves.toBeUndefined()
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not persist when operating-system encryption is unavailable', async () => {
    const { file } = await fixture()
    const unavailable = new ManagedModelCredentialStore(file, {
      ...cipher,
      isEncryptionAvailable: () => false,
    })

    await expect(unavailable.save('001234', 'application-1', 'sk-sensitive')).resolves.toBe(false)
    await expect(unavailable.load('001234', 'application-1')).resolves.toBeUndefined()
  })

  it('upgrades a legacy credential after the Hub application is confirmed', async () => {
    const { file, store } = await fixture()
    await writeFile(file, cipher.encryptString(JSON.stringify({
      version: 1,
      workcode: '001234',
      apiKey: 'sk-legacy',
    })))

    await expect(store.load('001234', 'application-1')).resolves.toBe('sk-legacy')
    expect(JSON.parse(cipher.decryptString(await readFile(file)))).toEqual({
      version: 2,
      workcode: '001234',
      applicationId: 'application-1',
      apiKey: 'sk-legacy',
    })
  })

  it('restores a credential from the legacy Electron user-data directory without overwriting the target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-credential-migration-'))
    temporaryDirectories.push(directory)
    const legacyFile = join(directory, 'legacy', 'managed-litellm-key.bin')
    const targetFile = join(directory, 'stable', 'managed-model-key.bin')
    await mkdir(join(directory, 'legacy'), { recursive: true })
    await writeFile(legacyFile, 'legacy')

    await expect(migrateManagedModelCredential(targetFile, [join(directory, 'missing'), legacyFile]))
      .resolves.toBe(legacyFile)
    await expect(readFile(targetFile, 'utf8')).resolves.toBe('legacy')
    await writeFile(targetFile, 'current')
    await expect(migrateManagedModelCredential(targetFile, [legacyFile])).resolves.toBeUndefined()
    await expect(readFile(targetFile, 'utf8')).resolves.toBe('current')
  })
})
