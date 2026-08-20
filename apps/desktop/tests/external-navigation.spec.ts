import { describe, expect, it } from 'vitest'
import { allowedExternalHttpUrl } from '../src/external-navigation.ts'

describe('desktop external navigation', () => {
  it('preserves HTTP(S) download URLs exactly', () => {
    const signedDownload = 'http://127.0.0.1:8788/reports/export.xlsx?signature=a%2Bb%2Fc&expires=1800'

    expect(allowedExternalHttpUrl(signedDownload)).toBe(signedDownload)
    expect(allowedExternalHttpUrl('HTTPS://downloads.example.com/report.xlsx')).toBe(
      'HTTPS://downloads.example.com/report.xlsx',
    )
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/report.xlsx',
    'mailto:user@example.com',
    '/relative/report.xlsx',
    'not a url',
  ])('blocks a non-web target: %s', (target) => {
    expect(allowedExternalHttpUrl(target)).toBeUndefined()
  })
})
