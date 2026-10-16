# Agent Note: GUI and documentation regression checks

Status: implemented

English | [中文](2026-10-16-gui-documentation-checks.zh.md)

## Problem

GUI expectations and generated documentation can drift from shipped composition while the community workflow remains green. An image-only attachment provider also exposes a disabled document policy with zero limits; rejecting that policy breaks history reads for otherwise valid image sessions.

## Decision

Document-policy projections accept nonnegative integers, including the base service's disabled zero policy, while rejecting negative, fractional, and non-finite limits. This changes wire validation, not document admission or provider capabilities. Projection regressions retain a real image-only provider and verify its history response.

The source Win32 dialog launcher resolves its ESM loader through Node's module resolver so Vitest's module runner can still exercise the real child process. GUI tests query the locale their fixtures install and snapshot the shipped community branding; they do not change production copy or skip failing scenarios.

Community CI executes the GUI suite and documentation checks. Generated catalogs come from current source, public JSDoc describes actual arguments and results, and paired references stay synchronized. Upstream workflow notes identify their scope instead of presenting removed workflows as this fork's installed CI.

## Alternatives considered

**Skip failures or relax checks:** rejected because a stale fixture and a rejected supported policy need different repairs. Existing assertions and documentation validation remain enabled.

**Assign positive document limits to image-only providers:** rejected because it advertises unsupported capacity instead of representing the existing disabled state.

**Restore the entire upstream workflow set:** rejected because external-model secrets, distribution jobs, and platform runners are independent operational choices, not prerequisites for local documentation integrity.

## Consequences

The community verification job takes longer and catches GUI/documentation drift before merge. Local real-worker checks still exercise only the current platform; a non-Windows pass does not establish Win32 dialog acceptance on Windows. No production deployment follows from these checks.
