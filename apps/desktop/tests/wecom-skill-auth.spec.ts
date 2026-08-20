import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseWeComAuthStatus,
  WECOM_READ_SESSION_MS,
  WECOM_WRITE_SESSION_MS,
  WeComSkillAuthManager,
  type WeComSkillAuthState,
} from '../src/wecom-skill-auth.ts'

const roots: string[] = []
const previousFakeState = process.env.WECOM_FAKE_STATE
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
}

afterEach(async () => {
  if (previousFakeState === undefined) delete process.env.WECOM_FAKE_STATE
  else process.env.WECOM_FAKE_STATE = previousFakeState
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('WeCom Skill authorization', () => {
  it('accepts only the official machine-readable authorization states', () => {
    expect(parseWeComAuthStatus('authorized\n')).toBe('authorized')
    expect(parseWeComAuthStatus('unauthorized\n')).toBe('unauthorized')
    expect(parseWeComAuthStatus('authorization pending\n')).toBeUndefined()
  })

  it.runIf(process.platform !== 'win32')('publishes the QR and reports completion without exposing credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wecom-skill-auth-'))
    roots.push(root)
    const cli = join(root, 'wecom-cli')
    const stateFile = join(root, 'state')
    process.env.WECOM_FAKE_STATE = stateFile
    await writeFile(cli, `#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('wecom-cli 1.1.0'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'show') { console.log(existsSync(process.env.WECOM_FAKE_STATE) ? 'authorized' : 'unauthorized'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'init') {
  writeFileSync('authorization.png', Buffer.from('iVBORw0KGgo=', 'base64'))
  setTimeout(() => { writeFileSync(process.env.WECOM_FAKE_STATE, 'ok'); process.exit(0) }, 120)
}
`, { mode: 0o700 })
    await chmod(cli, 0o700)
    const events: WeComSkillAuthState[] = []
    let now = Date.parse('2026-08-19T00:00:00Z')
    const manager = new WeComSkillAuthManager(cli, root, '1000001', safeStorage, state => events.push(state), () => now)

    await expect(manager.state()).resolves.toMatchObject({ status: 'unauthorized', version: '1.1.0' })
    await expect(manager.start()).resolves.toMatchObject({ status: 'authorizing' })
    await expect.poll(() => events.some(state => state.status === 'authorizing' && state.qrDataUrl?.startsWith('data:image/png;base64,'))).toBe(true)
    await expect.poll(() => events.at(-1)?.status).toBe('authorized')
    await expect(manager.authorizationForTool(false)).resolves.toMatchObject({
      workcode: '1000001', authorizedAt: now, expiresAt: now + WECOM_READ_SESSION_MS,
      writeExpiresAt: now + WECOM_WRITE_SESSION_MS,
    })
    await expect(readFile(stateFile, 'utf8')).resolves.toBe('ok')

    // Restarting the application reuses the encrypted, workcode-bound lease.
    manager.dispose()
    const restarted = new WeComSkillAuthManager(cli, root, '1000001', safeStorage, undefined, () => now + 60_000)
    await expect(restarted.state()).resolves.toMatchObject({ status: 'authorized' })
    await expect(restarted.authorizationForTool(true)).resolves.toBeDefined()

    now += WECOM_WRITE_SESSION_MS + 1
    await expect(restarted.state()).resolves.toMatchObject({
      status: 'authorized', writeReauthenticationRequired: true,
    })
    await expect(restarted.authorizationForTool(false)).resolves.toBeDefined()
    await expect(restarted.authorizationForTool(true)).resolves.toBeUndefined()

    now += WECOM_READ_SESSION_MS
    await expect(restarted.state()).resolves.toMatchObject({ status: 'unauthorized', reason: 'expired' })
    await expect(restarted.authorizationForTool(false)).resolves.toBeUndefined()
    restarted.dispose()
  })

  it.runIf(process.platform !== 'win32')('does not trust a persistent CLI login without a Harness lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wecom-skill-auth-workcode-'))
    roots.push(root)
    const cli = join(root, 'wecom-cli')
    const stateFile = join(root, 'state')
    process.env.WECOM_FAKE_STATE = stateFile
    await writeFile(stateFile, 'ok')
    await writeFile(cli, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('wecom-cli 1.1.0'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'show') { console.log('authorized'); process.exit(0) }
`, { mode: 0o700 })
    await chmod(cli, 0o700)

    const manager = new WeComSkillAuthManager(cli, root, '5000271', safeStorage)
    await expect(manager.state()).resolves.toMatchObject({
      status: 'unauthorized', reason: 'reauthentication-required',
    })
    manager.dispose()
  })
})
