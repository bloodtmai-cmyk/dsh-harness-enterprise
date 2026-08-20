import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_TEXT_BYTES = 4 * 1024 * 1024
const MAX_BINARY_BYTES = 20 * 1024 * 1024

const TEXT_MIME = new Map<string, string>([
  ['.css', 'text/css'],
  ['.csv', 'text/csv'],
  ['.go', 'text/plain'],
  ['.java', 'text/plain'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.jsx', 'text/javascript'],
  ['.log', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.mdx', 'text/markdown'],
  ['.py', 'text/plain'],
  ['.rs', 'text/plain'],
  ['.scss', 'text/css'],
  ['.sh', 'text/plain'],
  ['.sql', 'text/plain'],
  ['.toml', 'text/plain'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.txt', 'text/plain'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
])

const IMAGE_MIME = new Map<string, string>([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

export interface DesktopPreviewRequest {
  path: string
  workspaceRoot: string
}

export type DesktopPreviewFile = {
  name: string
  displayPath: string
  mime: string
} & (
  | { kind: 'html' | 'markdown' | 'text'; content: string }
  | { kind: 'image' | 'pdf'; dataUrl: string }
)

export class DesktopPreviewError extends Error {
  constructor(readonly code: 'invalid-request' | 'outside-workspace' | 'not-file' | 'unsupported' | 'too-large') {
    super(code)
    this.name = 'DesktopPreviewError'
  }
}

function isInside(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

export async function resolveDesktopPreviewPath(request: DesktopPreviewRequest): Promise<{
  path: string
  root: string
  displayPath: string
}> {
  if (typeof request.path !== 'string' || request.path.trim() === ''
    || typeof request.workspaceRoot !== 'string' || request.workspaceRoot.trim() === '') {
    throw new DesktopPreviewError('invalid-request')
  }

  const requestedRoot = resolve(request.workspaceRoot)
  const requestedPath = isAbsolute(request.path) ? resolve(request.path) : resolve(requestedRoot, request.path)
  let root: string
  let path: string
  try {
    [root, path] = await Promise.all([realpath(requestedRoot), realpath(requestedPath)])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new DesktopPreviewError('not-file')
    throw error
  }
  if (!isInside(root, path)) throw new DesktopPreviewError('outside-workspace')

  const info = await stat(path)
  if (!info.isFile()) throw new DesktopPreviewError('not-file')
  return { path, root, displayPath: relative(root, path) || basename(path) }
}

export async function readDesktopPreviewFile(request: DesktopPreviewRequest): Promise<DesktopPreviewFile> {
  const target = await resolveDesktopPreviewPath(request)
  const extension = extname(target.path).toLowerCase()
  const info = await stat(target.path)
  const shared = { name: basename(target.path), displayPath: target.displayPath }

  if (extension === '.html' || extension === '.htm') {
    if (info.size > MAX_TEXT_BYTES) throw new DesktopPreviewError('too-large')
    return { ...shared, kind: 'html', mime: 'text/html', content: await readFile(target.path, 'utf8') }
  }

  const textMime = TEXT_MIME.get(extension)
  if (textMime !== undefined) {
    if (info.size > MAX_TEXT_BYTES) throw new DesktopPreviewError('too-large')
    const kind = textMime === 'text/markdown' ? 'markdown' : 'text'
    return { ...shared, kind, mime: textMime, content: await readFile(target.path, 'utf8') }
  }

  const binaryMime = extension === '.pdf' ? 'application/pdf' : IMAGE_MIME.get(extension)
  if (binaryMime !== undefined) {
    if (info.size > MAX_BINARY_BYTES) throw new DesktopPreviewError('too-large')
    const data = await readFile(target.path)
    return {
      ...shared,
      kind: extension === '.pdf' ? 'pdf' : 'image',
      mime: binaryMime,
      dataUrl: `data:${binaryMime};base64,${data.toString('base64')}`,
    }
  }

  throw new DesktopPreviewError('unsupported')
}
