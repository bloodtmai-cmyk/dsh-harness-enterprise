import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadDesktopLanguage,
  persistDesktopLanguage,
  systemDesktopLanguage,
} from '../src/desktop-language.ts'

const temporaryDirectories: string[] = []

async function settingsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-language-'))
  temporaryDirectories.push(directory)
  return join(directory, 'settings.yaml')
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop working language', () => {
  it('uses the OS-derived fallback when no preference exists', async () => {
    const path = await settingsPath()
    await expect(loadDesktopLanguage(path, 'en')).resolves.toBe('en')
    expect(systemDesktopLanguage('en-US')).toBe('en')
    expect(systemDesktopLanguage('zh-CN')).toBe('zh')
    expect(systemDesktopLanguage('fr-FR')).toBe('zh')
  })

  it('persists the selected language and preserves unrelated settings', async () => {
    const path = await settingsPath()
    await writeFile(path, '# retained comment\nui-theme:\n  preference: dark\nlocale:\n  preference: zh\n')

    await persistDesktopLanguage(path, 'en')

    await expect(loadDesktopLanguage(path, 'zh')).resolves.toBe('en')
    const text = await readFile(path, 'utf8')
    expect(text).toContain('# retained comment')
    expect(text).toContain('preference: dark')
    expect(text).toContain('preference: en')
  })

  it('creates a private settings document for a first-time selection', async () => {
    const path = await settingsPath()
    await persistDesktopLanguage(path, 'zh')
    await expect(loadDesktopLanguage(path, 'en')).resolves.toBe('zh')
  })

  it('rejects a non-object settings root without replacing the original document', async () => {
    const path = await settingsPath()
    await writeFile(path, 'not-an-object\n')

    await expect(persistDesktopLanguage(path, 'en')).rejects.toThrow('settings document root must be an object')
    await expect(readFile(path, 'utf8')).resolves.toBe('not-an-object\n')
  })
})
