/**
 * Return an external URL that the desktop host may hand to the operating
 * system, or undefined when the renderer target must remain blocked.
 *
 * The original string is preserved because signed download URLs can depend on
 * their exact query encoding.
 *
 * @param target - Untrusted popup target supplied by the renderer.
 * @returns The original HTTP(S) URL, or undefined for every other target.
 */
export function allowedExternalHttpUrl(target: string): string | undefined {
  try {
    const protocol = new URL(target).protocol.toLowerCase()
    return protocol === 'http:' || protocol === 'https:' ? target : undefined
  } catch {
    return undefined
  }
}
