# Agent Note: LAN HTTP client access

Status: implemented

English | [中文](2026-10-16-lan-http-client-access.zh.md)

## Problem

LAN deployments over plain HTTP do not expose `crypto.randomUUID` in browsers. RPC correlation, message construction, and attachment drafts must still generate random identities. Trusted LAN authorities also receive opaque 403 responses when configuration calls require loopback access.

## Decision

Browser-reachable UUID consumers use `uuid` v4, including the existing Connection helper. Its browser implementation uses `crypto.getRandomValues` when secure-context `randomUUID` is absent; Node resolves its Node implementation. The dependency is declared by each consuming package and pinned by the workspace lockfile.

Privileged API requests retain the loopback and same-origin checks. After the general Host fence accepts a request, a privileged denial returns HTTP 403 with JSON code `loopback-required` and the same value in `x-dsh-error-code`. Both unary clients map that marker to actionable local-access guidance without reflecting arbitrary response text. The remote settings page displays localized guidance through the existing General item slot.

## Alternatives considered

**Global polyfill:** mutating `crypto` or injecting a script into generated HTML obscures which packages depend on secure-context behavior and leaves other browser entry points uncovered.

**Remote privilege opt-in:** a trusted Host is a DNS-rebinding control, not user authentication. Broadening credential and preset management without an authentication layer is not required to explain the existing restriction.

## Consequences

LAN HTTP can carry ordinary RPC calls, but configuration management still requires server-local browsing or SSH local forwarding to `127.0.0.1`. HTTPS alone does not grant privileged access. Host rejection remains an opaque 403; only accepted authorities receive the privilege-specific diagnostic. Ordinary remote session operations remain capable of running tools, so this is not a multi-user security boundary.

## Testing

Focused tests cover message construction, attachment drafts, RPC identity generation, denial diagnostics, and preserved Host rejection. The real Web composition temporarily listens on all interfaces and runs in Chromium over HTTP through a local non-loopback IPv4 address with secure-context APIs absent, snapshotting the remote settings guidance. This avoids external DNS dependencies; the test requires such an interface. The scaffold defaults to loopback for other scenarios. No model credentials are required.
