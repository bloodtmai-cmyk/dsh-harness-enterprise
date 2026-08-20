/** Package-owned invariant companion for the Stream Activity UI plug-in. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-stream-activity'

/** Cordis companion plug-in name. */
export const name = 'client-ui-stream-activity-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

// No runtime invariant: CSS-only presentation owns no cross-plug-in mutable state.
const install: InvariantInstaller = () => {}

/** Register package ownership with the shared invariant registry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
