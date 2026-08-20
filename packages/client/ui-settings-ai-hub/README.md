# AI Hub Enterprise Market

English | [中文](README.zh.md)

`@deepseek-ai/dsh-client-ui-settings-ai-hub` contributes an **Enterprise market** destination to the left sidebar rather than Web Settings. The entry renders only while the live AI Hub menu entitlement includes `PLUGIN_MARKET`; revocation hides the entry and closes an open market. It presents published MCP, Skill, Bundle, and client-plugin items together with the current user's available, pending, authorized, or rejected state. Enterprise instructions are global policy and therefore do not appear in the requestable catalog.

The contribution resolves menu access, reads the market, and submits requests through `ctx.remote.aiHubCatalog`. It never receives an AI Hub token, installs artifacts, or calls MCP Gateway. The Host obtains a short-lived token from the desktop loopback broker and calls AI Hub on its behalf. Menu access fails closed and refreshes every minute; loading, unavailable, empty, error, retry, narrow-layout, category-filter, and inline request states remain local to the modal market surface.

The Electron owner polls authorization changes and owns artifact installation. Skill, enterprise-instruction, MCP/Tool visibility, and accepted `activation=hot` client plug-ins update in place; a plug-in is acknowledged only after its managed Patch SHA-256 commits, and a failed candidate rolls back to the previous healthy generation. The compact icon-only action beside Settings is reserved for Harness binary releases, remains visible without the market-menu entitlement, and opens one native choice between an immediate verified download plus restart and a silent update on the next launch.

## Model Experience

None, as this package only manages the browser-side market workflow and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Bounded hot activation** - arbitrary module-directory HMR remains disabled. Only the exact AI Hub-managed Patch is watched and transactionally recomposed; failed plug-ins roll back and retry once at the next launch.
- **Live menu enforcement** - the sidebar hides without `PLUGIN_MARKET`, and AI Hub separately enforces the same entitlement on market requests.
- **User request only** - grant, revoke, publication, and artifact approval remain administrator operations in AI Hub.
