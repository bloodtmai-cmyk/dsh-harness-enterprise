import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(root, 'assets', 'icons')
const outputDirectory = resolve(root, 'build', 'icons')
const minimumVisibleAlpha = 32

const variants = ['light', 'dark']

await mkdir(outputDirectory, { recursive: true })
await Promise.all(variants.map(async (name) => {
  const { data, info } = await sharp(resolve(sourceDirectory, `app-icon-${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  // Remove faint disconnected pixels around the supplied transparent artwork.
  for (let alpha = 3; alpha < data.length; alpha += info.channels) {
    if (data[alpha] >= minimumVisibleAlpha) continue
    data.fill(0, alpha - 3, alpha + 1)
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(1_024, 1_024, { fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(outputDirectory, `app-icon-${name}.png`))
}))
