import { describe, expect, it } from 'vitest'
import { resolveUserPatches } from '../src/profile-boot.ts'

describe('managed profile policy', () => {
  it('keeps user patches for ordinary launches', () => {
    expect(resolveUserPatches(undefined)).toBe(true)
    expect(resolveUserPatches('0')).toBe(true)
  })

  it('disables user patches only for an explicit managed launch', () => {
    expect(resolveUserPatches('1')).toBe(false)
  })

  it('lets an embedder state an explicit policy', () => {
    expect(resolveUserPatches('1', true)).toBe(true)
    expect(resolveUserPatches(undefined, false)).toBe(false)
  })
})
