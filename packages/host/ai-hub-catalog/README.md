# AI Hub Catalog Host

English | [中文](README.zh.md)

`@deepseek-ai/dsh-host-ai-hub-catalog` exposes the AI Hub enterprise market to trusted Web clients through narrow Typert Remotes.

The browser never receives the Hub token. The Host asks the desktop loopback broker for a short-lived token, resolves live menu entitlements, fetches published market items, and submits capability requests. The startup `DSH_AI_HUB_CATALOG` snapshot remains available for local runtime projection and contains no secret or transport fields.

Outside the managed desktop, the Remote returns unavailable empty catalog and entitlement results. Malformed or oversized snapshots fail closed while the plugin mounts.

This package calls only the configured AI Hub client API. It does not download artifacts, call MCP Gateway, or decide authorization.

## Model Experience

None, as this Host-only catalog projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No artifact ownership** - download, verification, installation, and reconciliation remain in Electron.
- **Narrow menu contract** - the current client contract exposes only the `PLUGIN_MARKET` menu key; other enterprise menus need explicit typed additions.
- **No admin operations** - publication, approval, grant, revoke, and Gateway invocation remain with their owning systems.
