# Personal Local Memory

English | [中文](README.zh.md)

`@deepseek-ai/dsh-personal-memory-local` connects to the Electron main process through the authenticated loopback broker. The main process stores one Electron `safeStorage`-encrypted document per hashed workcode namespace. Automatic capture is enabled for new users, can be switched off from Settings without restarting, never uploads entries to AI Hub, and degrades closed when operating-system credential encryption is unavailable.

The plugin follows Harness's native `session/event` lifecycle. It buffers direct `source.kind=user` messages and runs a conservative deterministic extractor after a completed matching `turn/end`. Explicit stable preferences, facts, and project context are learned only from human messages. A recent-work summary is created only when the final visible answer contains an explicit result such as completed, confirmed, fixed, decided, or verified. Each summary is capped at 320 characters. Code blocks, tables, command output, Tool traces, plugin-generated messages, restored history, and raw transcripts are never persisted. Every entry has a short title, summary, kind, and source `(sessionId, eventSeq)`. Secret-shaped and transient statements are rejected before the encrypted durable write, and prompt rendering masks secrets again.

Global preferences and personal facts form a small always-on capsule of at most 8 entries and 2,000 characters. Workspace context and recent work are keyed by a hash of the canonical working directory and are recalled only for the same workspace. Recent work is limited to 4 entries per Beijing calendar day, expires after 30 days, and is evicted before stable preferences, facts, and project context when the 200-entry or 80,000-character document budget is reached. Greetings, acknowledgements, and continue-only messages do not recall anything; requests must explicitly depend on history, preferences, projects, or prior conclusions. One request receives at most 5 matching entries, including at most 2 recent-work summaries and 600 recent-work characters. There is no memory Tool, no secondary LLM summarizer, and no manual add/edit flow. Settings remains user-visible for enable/disable, injection preview, inspection, deletion, and clearing. Schema v4 automatically compresses legacy `JOURNAL` entries into short goal/conclusion/source records.

## Configuration

```ts
export interface Config {
  tokenBrokerURL: string
  tokenBrokerSecret: string
  maxPromptEntries: number
  maxPromptChars: number
  snapshotRefreshMs: number
  maxQueryResults: number
  autoJournalMinChars: number
}
```

The respective defaults are 8 entries, 2,000 characters, a 5,000 millisecond poll, 5 query results, and an 80-character base threshold. The broker URL must use loopback HTTP. The secret is generated for each Electron process and never enters the renderer. The Host plugin always remains mounted, so Settings changes are observed by the five-second state poll instead of changing Cordis composition.

## Model Experience

The system prompt receives only the small global capsule. Relevant global and current-workspace entries are recalled locally on the first step and appended as a sourced runtime message. Both forms are delimiter-framed, escape literal `<`, mask secret-shaped text, and state that memory is untrusted data below enterprise instructions, safety policy, identity, permissions, and the current user message.

An empty or disabled store adds no memory text. Stable capsules remain prompt-cache friendly; changes are adopted within five seconds. Recall is deterministic and local, so no second model call, embedding service, or network memory provider receives the entries.

## Known Limitations

- **Conservative lexical capture and recall** - the extractor intentionally misses implicit facts rather than learning assistant guesses or broad prose; retrieval is token-based, not semantic.
- **Recent work, durable facts** - workspace summaries are a bounded recent-work ledger, not an indefinite transcript archive; stable preferences, facts, and context remain until the user deletes them.
- **One-device ownership** - entries do not roam between installations and are not recoverable from AI Hub.
- **User correction is explicit** - automatically captured entries can be inspected and deleted from Settings; the system does not silently rewrite a conflicting memory.
