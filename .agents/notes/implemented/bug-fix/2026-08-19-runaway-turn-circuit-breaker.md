# Agent Note: Stop runaway turns before the next provider request

Status: implemented

English | [中文](2026-08-19-runaway-turn-circuit-breaker.zh.md)

## Problem

A model can repeatedly produce valid tool calls or a recovery listener can keep retrying a failed request. Both paths make progress from the state machine's perspective, so the previous loop had no terminal condition. A small user request could therefore consume provider quota until an external balance or process limit stopped it. Bounding only parallel tool calls does not help because the requests remain sequential and individually valid.

## Decision

`AgentLoop` owns three positive deployment limits: steps per turn, provider attempts per step, and cumulative reported tokens per turn. The driver checks the step and token ceilings before preparing the next model step. A same-step retry is refused after the configured attempt count. All three paths end the durable turn with `AGENT_LOOP_CIRCUIT_OPEN`; the failure is raised outside `agent/request-error`, so request recovery cannot retry the breaker itself.

The token counter sums the disjoint input, output, cache-read, and cache-write fields reported by every provider attempt. Reasoning tokens are not added separately because they are already part of output tokens. A tool call that crosses the token ceiling is allowed to finish and persist its tool result, then the next model request is stopped. A terminal response that crosses the ceiling remains successful because it creates no further spend. A new user turn starts with fresh counters.

Package defaults are deliberately high enough for complex automation: 64 steps, 8 attempts per step, and 2,000,000 reported tokens. The managed desktop overlay uses 24 steps, 4 attempts, and 500,000 reported tokens. These fields are absent from user Settings so a managed client cannot disable the safety policy.

## Alternatives considered

**Detect an identical tool name and arguments.** Rejected as the primary breaker: polling, paginated reads, terminal writes, and status checks can legitimately repeat the same signature. A deterministic resource ceiling is easier to audit and cannot be evaded by slightly changing arguments.

**Rely on provider quota or LiteLLM balance only.** Rejected: it stops the incident after avoidable spend and gives the client no precise durable failure reason. Gateway quota remains a second layer, not the first breaker.

**Expose the limits as user settings.** Rejected for managed deployments because a local user could relax the enterprise protection. Composition config remains available to trusted deployments.

**Add a currency ceiling in the client.** Deferred: model pricing and tenant policy belong to LiteLLM/AI Hub. The client does not have a trustworthy price table.

## Consequences

Legitimate work that reaches a ceiling ends explicitly instead of continuing indefinitely. The transcript preserves completed messages and tool results, and the UI replaces the internal English diagnostic with localized guidance. Providers that omit usage cannot be token-bounded, but the independent step and attempt ceilings still terminate their loops. Operators can identify every intervention by the stable error code in the session audit.
