# Personal Memory Settings

English | [中文](README.zh.md)

`@deepseek-ai/dsh-client-ui-settings-personal-memory` contributes a desktop-only **Personal memory** section to System Settings when the context-isolated preload exposes the narrow personal-memory bridge. It shows the hot enable switch, automatically captured entry count, the maximum next-turn injection preview, stable-memory and recent-work labels, and delete/clear controls. Each entry exposes a short title, summary, kind, local-conversation source, and timestamp. It deliberately has no manual add or edit form. The component receives no workcode, encryption key, AI Hub token, or filesystem path.

Destructive deletion and clear-all actions require confirmation. The UI publishes success only after the main-process operation commits and reports system-encryption unavailability without offering a raw configuration-file escape hatch.

## Model Experience

### Settings contribution

#### What the model sees

Nothing. This package renders local settings through IPC; the separate Host plugin owns automatic capture and bounded model-facing recall.

#### Token effect

None. The browser contribution does not assemble or send provider requests.

#### KV Cache effect

None directly. Toggling the feature or deleting entries changes the separate Host plugin's documented model input within its polling interval.

## Known Limitations and Deferred Work

- **Desktop only** - the section is absent when the Electron preload bridge is unavailable.
- **Polling delay** - enablement and deletion are hot, but the Host may take up to five seconds to observe the committed state.
