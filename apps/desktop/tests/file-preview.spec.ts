import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readDesktopPreviewFile,
  resolveDesktopPreviewPath,
} from '../src/file-preview.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-preview-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('desktop file preview', () => {
  it('reads supported text and binary files inside the workspace', async () => {
    const root = await workspace()
    await mkdir(join(root, 'reports'))
    await writeFile(join(root, 'reports', 'summary.md'), '# 预览')
    await writeFile(join(root, 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    await expect(readDesktopPreviewFile({ path: 'reports/summary.md', workspaceRoot: root })).resolves.toMatchObject({
      kind: 'markdown',
      content: '# 预览',
      displayPath: join('reports', 'summary.md'),
    })
    await expect(readDesktopPreviewFile({ path: join(root, 'chart.png'), workspaceRoot: root })).resolves.toMatchObject({
      kind: 'image',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw==',
    })
  })

  it('rejects paths outside the current workspace', async () => {
    const root = await workspace()
    const outside = await workspace()
    const file = join(outside, 'secret.txt')
    await writeFile(file, 'secret')

    await expect(resolveDesktopPreviewPath({ path: file, workspaceRoot: root }))
      .rejects.toMatchObject({ code: 'outside-workspace' })
  })

  it.runIf(process.platform !== 'win32')('rejects a symlink that escapes the workspace', async () => {
    const root = await workspace()
    const outside = await workspace()
    const file = join(outside, 'secret.txt')
    await writeFile(file, 'secret')
    await symlink(file, join(root, 'linked.txt'))

    await expect(resolveDesktopPreviewPath({ path: 'linked.txt', workspaceRoot: root }))
      .rejects.toMatchObject({ code: 'outside-workspace' })
  })

  it('returns controlled errors for missing and unsupported files', async () => {
    const root = await workspace()
    await writeFile(join(root, 'archive.zip'), 'not really a zip')

    await expect(readDesktopPreviewFile({ path: 'missing.txt', workspaceRoot: root }))
      .rejects.toMatchObject({ code: 'not-file' })
    await expect(readDesktopPreviewFile({ path: 'archive.zip', workspaceRoot: root }))
      .rejects.toMatchObject({ code: 'unsupported' })
  })

  it('limits preview payload sizes', async () => {
    const root = await workspace()
    await writeFile(join(root, 'oversized.txt'), Buffer.alloc(4 * 1024 * 1024 + 1))

    await expect(readDesktopPreviewFile({ path: 'oversized.txt', workspaceRoot: root }))
      .rejects.toMatchObject({ code: 'too-large' })
  })
})
