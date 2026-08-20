# Agent Note: Unified Harness and managed-capability update timing

Status: implemented

English | [中文](2026-08-18-managed-client-plugin-upgrades.zh.md)

## Problem

Harness releases, version replacements of already authorized AI Hub capabilities, and new grants or revocations represent different user intent. Version upgrades should not open separate dialogs or force an interruption, while grants and revocations change the available topology. Production desktop HMR remains disabled, so restart-bound artifacts can activate only at a process boundary.

## Decision

Electron converges Harness releases and in-place MCP, Tool, Skill, Bundle, and client-plugin version replacements into one managed update queue. The AI Hub catalog is compared by type, stable `externalRef`, and the parent path for Tools inside an MCP; a delta is an upgrade only when the reference set is unchanged and a matching `releaseVersion` changes. New grants, revocations, and mixed topology changes remain on the ordinary reconciliation path. Enterprise instructions remain a separate hot-load channel that applies to the next model request.

Unified update state is published through a narrow context-isolated preload bridge. The sidebar shows one compact download icon even when `PLUGIN_MARKET` is not granted. Selecting it lists every pending update and offers two timings:

- **Update silently on next launch** leaves the current process unchanged. Capability artifacts install during the next startup reconciliation before the backend starts. The Harness target platform and version are persisted, then downloaded and installed automatically after the next authenticated launch without another Harness confirmation.
- **Download and restart now** downloads, verifies, and atomically replaces all pending capability artifacts before running the client installer or relaunching Harness. Windows uses `electron-updater` SHA-512 verification and `quitAndInstall`; macOS hands a SHA-256-verified DMG or PKG to the operating-system installer.

## Alternatives considered

- **Keep a separate dialog for each update source** would interrupt the user repeatedly when Harness, plug-ins, and capabilities have updates at the same time and could not schedule them together for the next launch.
- **Download immediately after detection** would consume bandwidth and change on-disk artifacts before the user chooses an update timing.
- **Treat new grants as deferrable upgrades** would mix administrator push intent with user version choice and allow revoked capabilities to linger longer.

## Consequences

Every restart-bound upgrade now has one discoverable entry and background detection opens no modal dialog. Scheduled, downloading, and failed states remain visible through the same icon. Failure preserves the current version and leaves a retry path. A deferred Harness update requires one non-sensitive local version pointer; a deferred capability update needs no separate journal because authoritative startup catalog synchronization already converges it.

## Verification

Desktop client tests cover stable-reference replacements for MCP, Tool, Skill, and plug-in versions and distinguish them from newly authorized topology. Sidebar component tests cover the unified update icon without market-menu permission. A static desktop contract test pins the unified IPC channels, deferred schedule, and `electron-updater` boundary.
