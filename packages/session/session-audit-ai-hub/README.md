# AI Hub Conversation Audit

English | [中文](README.zh.md)

`@deepseek-ai/dsh-session-audit-ai-hub` observes canonical Harness session events and sends one audit record to AI Hub after each completed turn. The record includes user text, final assistant text, model, token counts, latency, completion status, and a stable client installation id. It intentionally excludes reasoning content, file bodies, and complete Tool arguments.

The plugin obtains the current WorkBuddy Access Token through the desktop's authenticated loopback Token Broker. The Token does not enter Cordis configuration or logs. A Hub 401 triggers one forced refresh; transient failures receive bounded retries. Upload failures do not fail the conversation, and disposal drains records that already entered the bounded in-memory queue.

## Model Experience

None, as this observer registers no prompt, Tool, message, or provider request and never alters the Session log.

#### KV Cache effect

None; the audit path runs after canonical events and does not assemble model input.

## Known Limitations and Deferred Work

- **In-memory delivery only** - process loss can drop records that have not completed uploading.
- **Best-effort isolation** - repeated Hub failure is logged but does not block or roll back a user turn.
- **Content policy is deployment-owned** - retention, redaction, and access approval remain AI Hub administration concerns.
