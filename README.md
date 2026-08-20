<h1 align="center">Harness Enterprise</h1>

<p align="center">
  <strong>A managed DeepSeek Harness entry point for internal enterprise use.</strong><br>
  It combines enterprise sign-in, AI Hub policy, approved capabilities, audit delivery, and a hardened desktop runtime.
</p>

<p align="center"><sub>Independent community project based on DeepSeek Harness. It is not affiliated with, sponsored by, or endorsed by DeepSeek AI.</sub></p>

English | [中文](README.zh.md)

## What this repository is

Harness Enterprise keeps the standard DeepSeek Harness runtime and adds an optional managed desktop distribution. It is intended for organizations that need one internal AI workbench entry point while retaining control over identity, model access, MCP services, Skills, plug-ins, enterprise instructions, updates, and conversation audit delivery.

The project is deliberately not an identity provider, MDM product, business-data proxy, or replacement for downstream authorization. AI Hub governs what the desktop may discover and use; business systems remain responsible for their own data permissions.

## Components

| Component | Responsibility |
| --- | --- |
| Standard Harness | Upstream-compatible Web, Host, agent, tools, and plug-in runtime. Users may configure supported third-party model providers. |
| Harness Enterprise Desktop | Electron shell, enterprise sign-in, Hub synchronization, local runtime hardening, managed updates, and local personal memory. |
| DSH AI Hub | Separate control plane for authorization, model access records, managed artifacts, instructions, releases, and audit. |
| Enterprise Gateway | Pluggable authentication and MCP gateway. It validates identity and enforces current Hub policy at `tools/list` and `tools/call`. |

## Managed model access

The two model modes stay separate:

- Standard Harness retains its native third-party Provider, Base URL, and API Key settings.
- Managed desktop hides manual model credentials. AI Hub supplies the Provider identifier, OpenAI-compatible gateway URL, and API Key as one authorization record.
- A cached Key is usable only while Hub still reports an active authorization with complete endpoint metadata.
- LiteLLM is one possible gateway implementation, not a requirement.

See [the desktop documentation](apps/desktop/README.md) for the security and runtime contract.

## Run from source

Prerequisites: Node.js 24 and pnpm 11.7.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

The standard Web UI listens on `http://127.0.0.1:3080` by default. The managed desktop additionally requires a configured AI Hub, enterprise Gateway, and OpenAI-compatible model endpoint:

```sh
pnpm run desktop:dev
```

This repository publishes source code only. It does not provide signed macOS or Windows installers.

## Development

```sh
pnpm run typecheck
pnpm test
pnpm run verify-third-party-notices
pnpm run verify-translation-pairing
pnpm run verify-community-sanitization
```

Start with [the development guide](docs/development.md), [architecture documentation](docs/architecture.md), and [community release checklist](OPEN_SOURCE_CHECKLIST.md).

## Upstream and license

The core runtime comes from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and preserves its MIT attribution. This repository is independently maintained by `clanie`.

Licensed under the [MIT License](LICENSE). Third-party terms are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Security reports should follow [SECURITY.md](SECURITY.md).
