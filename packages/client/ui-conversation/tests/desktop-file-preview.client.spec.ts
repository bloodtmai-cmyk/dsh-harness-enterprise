// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_DETAILS_EVENT,
  DESKTOP_PREVIEW_EVENT,
  isDesktopPreviewPath,
  requestDesktopDetailsPane,
  requestDesktopFilePreview,
} from '../src/client/skeleton/DesktopFilePreview.tsx'

afterEach(() => {
  delete window.desktopPreview
})

describe('desktop preview requests', () => {
  it('recognizes only file types supported by the desktop bridge', () => {
    expect(isDesktopPreviewPath('report.md')).toBe(true)
    expect(isDesktopPreviewPath('diagram.SVG')).toBe(true)
    expect(isDesktopPreviewPath('archive.zip')).toBe(false)
  })

  it('does not intercept browser file opening without the Electron bridge', () => {
    const listener = vi.fn()
    window.addEventListener(DESKTOP_PREVIEW_EVENT, listener)

    expect(requestDesktopFilePreview({ path: '/workspace/report.md', workspaceRoot: '/workspace' })).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(DESKTOP_PREVIEW_EVENT, listener)
  })

  it('routes supported files and details selection through the existing right panel', () => {
    window.desktopPreview = {
      readFile: vi.fn(),
      openExternal: vi.fn(),
    }
    const preview = vi.fn()
    const details = vi.fn()
    window.addEventListener(DESKTOP_PREVIEW_EVENT, preview)
    window.addEventListener(DESKTOP_DETAILS_EVENT, details)
    const request = { path: '/workspace/report.md', workspaceRoot: '/workspace' }

    expect(requestDesktopFilePreview(request)).toBe(true)
    requestDesktopDetailsPane()

    expect((preview.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(request)
    expect(details).toHaveBeenCalledOnce()
    window.removeEventListener(DESKTOP_PREVIEW_EVENT, preview)
    window.removeEventListener(DESKTOP_DETAILS_EVENT, details)
  })
})
