import { readFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Document, parseDocument } from 'yaml'

export const DESKTOP_LANGUAGES = ['zh', 'en'] as const
export type DesktopLanguage = typeof DESKTOP_LANGUAGES[number]

export function isDesktopLanguage(value: unknown): value is DesktopLanguage {
  return value === 'zh' || value === 'en'
}

export function systemDesktopLanguage(locale: string): DesktopLanguage {
  return locale.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

function parseSettings(text: string): Document {
  const document = text.trim() === '' ? new Document({}) : parseDocument(text, { prettyErrors: true })
  const [parseError] = document.errors
  if (parseError !== undefined) throw new Error(parseError.message)
  const root = document.toJS() as unknown
  if (root === null) document.contents = document.createNode({})
  else if (typeof root !== 'object' || Array.isArray(root)) {
    throw new TypeError('settings document root must be an object')
  }
  return document
}

export async function loadDesktopLanguage(path: string, fallback: DesktopLanguage): Promise<DesktopLanguage> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
  const value = parseSettings(text).getIn(['locale', 'preference'])
  return isDesktopLanguage(value) ? value : fallback
}

export async function persistDesktopLanguage(path: string, language: DesktopLanguage): Promise<void> {
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const document = parseSettings(text)
  document.setIn(['locale', 'preference'], language)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
  try {
    await writeFile(temporary, String(document), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
