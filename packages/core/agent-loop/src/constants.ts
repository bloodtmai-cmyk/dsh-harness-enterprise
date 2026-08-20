/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Stable failure code emitted when a turn is stopped by a loop safety limit. */
export const AGENT_LOOP_CIRCUIT_OPEN_CODE = 'AGENT_LOOP_CIRCUIT_OPEN'

/** Default maximum number of model/tool steps admitted by one turn. */
export const DEFAULT_MAX_STEPS_PER_TURN = 64

/** Default maximum number of provider attempts admitted by one step. */
export const DEFAULT_MAX_REQUEST_ATTEMPTS_PER_STEP = 8

/** Default cumulative reported token ceiling for one turn. */
export const DEFAULT_MAX_TOKENS_PER_TURN = 2_000_000

/** Deployment-owned limits that stop a runaway turn before its next request. */
export interface AgentLoopCircuitBreakerLimits {
  maxStepsPerTurn: number
  maxRequestAttemptsPerStep: number
  maxTokensPerTurn: number
}

/** Package defaults used by direct driver construction and omitted config. */
export const DEFAULT_AGENT_LOOP_CIRCUIT_BREAKER_LIMITS: Readonly<AgentLoopCircuitBreakerLimits> = Object.freeze({
  maxStepsPerTurn: DEFAULT_MAX_STEPS_PER_TURN,
  maxRequestAttemptsPerStep: DEFAULT_MAX_REQUEST_ATTEMPTS_PER_STEP,
  maxTokensPerTurn: DEFAULT_MAX_TOKENS_PER_TURN,
})
