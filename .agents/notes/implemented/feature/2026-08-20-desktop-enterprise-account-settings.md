# Agent Note: Desktop enterprise profile and explicit sign-out

Status: implemented

English | [中文](2026-08-20-desktop-enterprise-account-settings.zh.md)

## Problem

The managed desktop application authenticated an enterprise user before launch, but Settings offered no place to inspect the identity bound to the running session and no explicit way to end it. Adding an ordinary browser-side account model would also risk exposing OAuth credentials or accepting identity values supplied by the renderer.

## Decision

- Add a desktop-only **Profile** Settings contribution backed by a narrow preload bridge. The first page shows the trusted workcode, authentication method, session expiry, and only optional LDAP or SSO attributes that are present in the verified WorkBuddy JWT.
- Verify and sanitize identity claims in the Electron OAuth client. The renderer receives no access token, refresh token, password, LiteLLM key, issuer control, or caller-supplied workcode.
- Keep sign-out as an explicit destructive action with inline confirmation. The main process validates the IPC sender, asks the Token Broker to revoke its latest session, records only credential-free diagnostics, and relaunches into the managed login page.
- Treat remote revocation as best effort. A network or provider failure cannot preserve the local logged-in process; Electron still quits and clears its in-memory session, while encrypted local data remains isolated by workcode.

## Verification

- OAuth tests cover signed profile extraction, duplicate department-code normalization, refresh preservation, and refresh-token revocation.
- Component tests cover complete and minimal profiles, inline sign-out confirmation, retry, and failure states.
- Desktop composition tests pin the preload IPC surface, sender-bound handler, package registration, and relaunch lifecycle. Focused TypeScript builds and the GUI suite cover the assembled client package.

## Consequences

The profile page can display only what the authentication Provider signs. The current token always provides the workcode; richer directory information appears automatically after the Provider adds the corresponding claims, without expanding the renderer's privilege. Signing out restarts the application by design so every Host, MCP, Skill, memory, and API Key binding is reconstructed under a newly authenticated workcode.
