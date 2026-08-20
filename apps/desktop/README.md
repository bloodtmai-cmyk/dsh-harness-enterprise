# Harness Enterprise Desktop

English | [中文](README.zh.md)

This is the Electron reference distribution for a managed DeepSeek Harness deployment. It owns enterprise sign-in, AI Hub policy synchronization, model-access verification, desktop updates, and the hardened local Web runtime.

## Model access modes

The repository preserves two deliberately separate modes:

- Standard Harness keeps its native model settings, where users can configure supported third-party providers, base URLs, and API keys.
- The managed desktop hides manual credential entry. An AI Hub approval stores the provider identifier, OpenAI-compatible model gateway URL, and API key together. After enterprise sign-in, the client claims the key and continues to obtain its matching URL from Hub.

A cached managed key is usable only while Hub still reports an active authorization with complete provider and gateway metadata. Legacy grants without an endpoint fail closed and must be reissued by an administrator.

LiteLLM can implement the enterprise gateway, but it is not a required dependency. The managed adapter uses `MODEL_GATEWAY_BASE_URL`, `MODEL_GATEWAY_API_KEY`, and `MODEL_GATEWAY_DEFAULT_MODEL`. Deprecated `LITELLM_*` aliases remain only for compatibility with older managed plug-ins.

## Enterprise configuration

Community deployments configure service endpoints through trusted process environment or deployment secrets:

```text
AI_HUB_BASE_URL=http://127.0.0.1:8090/ai-hub
WORKBUDDY_ISSUER=http://127.0.0.1:8090/enterprise-gateway
WORKBUDDY_MCP_URL=http://127.0.0.1:8090/enterprise-gateway/mcp
WORKBUDDY_REDIRECT_URI=workbuddy://enterprise-gateway/mcp/oauth/callback
```

Do not expose these values as editable settings to managed end users. The examples are local-development defaults only. Production requires trusted HTTPS origins, a correctly registered OAuth client, and matching JWKS, issuer, and audience values.

## Identity and capabilities

Sign-in uses OAuth Authorization Code with PKCE. Passwords are sent only to the authentication provider and never enter files, logs, or the Renderer. The verified employee identifier in the JWT becomes the trusted identity for API keys, audit, personal memory, and MCP authorization.

Authentication and authorization remain separate. Missing MCP, Skill, Bundle, or plugin grants cannot block sign-in. The Gateway filters capabilities during both `tools/list` and `tools/call` using current Hub policy. Managed instructions, Skills, MCP/Tool catalogs, and client plugins declaring `activation=hot` can update while the application runs.

## Local security

- Model keys are stored through Electron `safeStorage`; the Renderer and ordinary settings documents cannot read them.
- The local Web backend listens on a random `127.0.0.1` port and requires a per-run bearer token, so an ordinary browser cannot reuse the endpoint.
- The Renderer uses context isolation and sandboxing with Node integration disabled. Only explicit user clicks may open HTTP(S) links externally.
- Personal long-term memory stays local, is isolated by verified employee identity and workspace, is never uploaded to AI Hub, and cannot override enterprise policy.

## Development

```bash
pnpm --filter @deepseek-ai/dsh-desktop test
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop build
```

Running this desktop reference requires AI Hub, an enterprise Gateway, and an OpenAI-compatible model endpoint. Standard Harness third-party model configuration does not require those enterprise services.

## Packaging and release

Packaging validates the runtime closure for Host, Client, CLI, native dependencies, and managed plugins. Production macOS distribution requires Developer ID signing and notarization; Windows should use a signed NSIS installer. AI Hub publishes desktop update artifacts, and users may install immediately or on the next launch.

Before a public release, run `scripts/verify-community-sanitization.sh` from the repository root and review licenses, NOTICE/SBOM, screenshots, binary artifacts, and Git history. The community branch never pushes to a public remote automatically.
