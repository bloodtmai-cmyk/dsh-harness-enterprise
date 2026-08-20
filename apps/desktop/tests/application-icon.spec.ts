import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

function pixel(data: Buffer, channels: number, x: number, y: number): number[] {
  const offset = (y * 1_024 + x) * channels
  return [...data.subarray(offset, offset + channels)]
}

describe('desktop application icons', () => {
  it.each([
    ['light', 'bright'],
    ['dark', 'dark'],
  ] as const)('renders the supplied %s artwork on a transparent canvas', async (variant, tone) => {
    const path = new URL(`../build/icons/app-icon-${variant}.png`, import.meta.url)
    const { data, info } = await sharp(await readFile(path))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(info.width).toBe(1_024)
    expect(info.height).toBe(1_024)
    expect(pixel(data, info.channels, 0, 0)[3]).toBe(0)
    const background = pixel(data, info.channels, 512, 128)
    const [backgroundRed = 0, backgroundGreen = 0, backgroundBlue = 0, backgroundAlpha = 0] = background
    expect(backgroundAlpha).toBeGreaterThan(240)
    const backgroundLuminance = backgroundRed + backgroundGreen + backgroundBlue
    if (tone === 'bright') expect(backgroundLuminance).toBeGreaterThan(700)
    else expect(backgroundLuminance).toBeLessThan(200)

    const center = pixel(data, info.channels, 512, 512)
    const [centerRed = 0, centerGreen = 0, centerBlue = 0] = center
    expect(centerBlue).toBeGreaterThan(220)
    expect(centerGreen).toBeGreaterThan(100)
    expect(centerRed).toBeLessThan(30)
  })
})
