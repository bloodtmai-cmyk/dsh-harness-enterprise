# Agent Note: Desktop external download links

Status: implemented

English | [中文](2026-08-17-desktop-external-download-links.zh.md)

## Problem

Conversation Markdown correctly rendered absolute report URLs as links with `target="_blank"`, but the Electron hardening policy denied every new-window request without handing safe targets to the operating system. A signed Excel export therefore looked interactive while every click was silently discarded.

The renderer must remain unable to create arbitrary Electron windows or navigate the Harness surface to an untrusted origin. Report URLs may also contain short-lived signatures whose query encoding cannot be rewritten safely.

## Decision

The desktop main window keeps denying every renderer-created window. Before returning `deny`, its window-open handler validates the target with the pure `allowedExternalHttpUrl` helper. An explicit absolute HTTP or HTTPS target is passed unchanged to Electron `shell.openExternal`, which opens the user's default browser while the Harness window stays in place. Relative targets and every other protocol remain blocked.

The handler is installed only for the post-login main window. Login and loading windows retain the unconditional denial configured by `hardenedWindow`. If the operating system rejects an allowed target, the main process shows a localized error dialog instead of leaving another silent click.

## Alternatives considered

**Allow Electron to create a child `BrowserWindow`.** Rejected because it would turn untrusted conversation links into application-owned browsing contexts and weaken the existing popup isolation.

**Navigate the main Harness window to the report URL.** Rejected because it would replace the managed local application and discard the active session surface.

**Download arbitrary URLs inside the renderer.** Rejected because it would add renderer access to network and filesystem behavior, duplicate the operating system download path, and require a larger authenticated-download design.

**Normalize the URL before opening it.** Rejected because normalization can alter encoded query bytes used by a signed, short-lived report URL.

## Consequences

Signed HTTP(S) report links now open through the default browser and can complete their normal download flow. Popup creation, relative navigation, and `javascript:`, `data:`, `file:`, and `mailto:` targets stay inert.

The behavior is covered by URL-policy tests, desktop-source wiring assertions, TypeScript compilation, and the existing desktop test suite. The fix does not alter Markdown parsing or the ordinary browser assembly.
