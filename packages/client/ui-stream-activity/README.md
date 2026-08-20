# @deepseek-ai/dsh-client-ui-stream-activity

English | [中文](README.zh.md)

Managed-desktop presentation plug-in for the live conversation process. It uses stable data attributes published by `ui-conversation` and `ui-tool` to render reasoning and Tool activity as a compact, low-noise stream. Running steps keep a small active marker, completed work remains available in the existing disclosure, and expanded payloads keep the original auditable cards.

The plug-in is CSS-only. It does not alter assistant content, Tool calls, approvals, event storage, or audit projection. Removing its Cordis row restores the base Harness presentation.

## Model Experience

None, as the plug-in changes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None. The plug-in neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **Presentation only** — the plug-in does not rewrite model-provided reasoning text or Tool summaries. It depends on the stable `data-stream-*` contract and deliberately leaves expanded payload layout to the owning components.
