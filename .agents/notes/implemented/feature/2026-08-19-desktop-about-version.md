# Agent Note: Desktop About Version

Status: implemented

English | [中文](2026-08-19-desktop-about-version.zh.md)

## Problem

Windows does not provide the macOS application menu that exposes Electron's About dialog, so desktop users have no reliable in-product path to identify the installed Harness version when reporting an issue or checking an upgrade.

## Decision

The Electron main window passes `app.getVersion()` to its context-isolated preload as a non-secret renderer argument. The preload exposes the product name and installed version through a read-only `desktopAppInfo` value. `ui-settings-general` registers an About section only when that value exists, which keeps the desktop application version distinct from Host package versions and leaves ordinary Web Harness settings unchanged.

## Alternatives considered

**Display the Host handshake version.** Rejected because the independently packaged Electron application is the artifact users install and upgrade; a Host package version can differ and would misidentify the Windows installation.

**Rely on operating-system About UI.** Rejected because the Windows menu configuration does not expose the macOS-style application menu, which is the original visibility gap.

## Consequences

Windows and macOS desktop users can read the installed version under Settings > About. The preload carries one additional non-secret static value, while browsers receive no desktop identity and render no About entry.
