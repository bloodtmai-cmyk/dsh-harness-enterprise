/** Package-owned invariant companion. @module @deepseek-ai/dsh-personal-memory-local/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-personal-memory-local'

export const name = 'personal-memory-local-invariant'
export const inject = ['invariants']

/** No runtime invariant: the authenticated loopback broker and encrypted store validate every operation. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
