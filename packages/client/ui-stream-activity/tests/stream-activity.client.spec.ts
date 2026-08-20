import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/StreamActivity.module.css', import.meta.url)), 'utf8')

describe('Stream Activity presentation contract', () => {
  it('targets stable activity attributes and keeps a reduced-motion path', () => {
    expect(css).toContain('[data-stream-activity-surface]')
    expect(css).toContain('[data-stream-step]')
    expect(css).toContain('[data-stream-process-body]')
    expect(css).toContain('[data-stream-turn-status]')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('removes the broad running-row shimmer without hiding expanded details', () => {
    expect(css).toContain("[data-state='running'] [data-disclosure-row]::after")
    expect(css).toContain('display: none')
    expect(css).not.toContain('visibility: hidden')
  })
})
