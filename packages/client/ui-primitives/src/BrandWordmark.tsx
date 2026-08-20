import type { IconProps } from './icons/props.ts'
import { FishLogo } from './FishLogo.tsx'

const WORDMARK_GAP = 10
const HARNESS_WIDTH = 49
const HARNESS_HEIGHT = 14
const WORDMARK_WIDTH = 24 + WORDMARK_GAP + HARNESS_WIDTH

/**
 * Render the Harness Enterprise wordmark while retaining the familiar whale mark.
 * @param props.size - height in px (default 24; width keeps the 141:24 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  const scale = size / 24
  return (
    <span
      data-brand-wordmark
      className={className}
      aria-hidden="true"
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        flex: 'none',
        gap: WORDMARK_GAP * scale,
        height: size,
        width: WORDMARK_WIDTH * scale,
      }}
    >
      <FishLogo size={size} />
      <span
        data-harness-badge
        style={{
          alignItems: 'center',
          backgroundColor: 'currentColor',
          borderRadius: 2 * scale,
          display: 'inline-flex',
          flex: 'none',
          height: HARNESS_HEIGHT * scale,
          justifyContent: 'center',
          width: HARNESS_WIDTH * scale,
        }}
      >
        <span
          style={{
            color: 'var(--dsw-alias-label-primary-inverted, #fff)',
            fontFamily: 'Arial, sans-serif',
            fontSize: 6.5 * scale,
            fontWeight: 700,
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          HARNESS
        </span>
      </span>
    </span>
  )
}
