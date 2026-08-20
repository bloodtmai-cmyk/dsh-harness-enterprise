# `@deepseek-ai/dsh-llm-openai-compatible-managed`

English | [中文](README.zh.md)

This deployment adapter registers one `managed` provider from an OpenAI-compatible gateway's `GET /models` response. It exposes neither a settings namespace nor configurable-provider directory, so the discovered list is the complete model authority for the process and an arbitrary model id fails with `UNKNOWN_MODEL` before network I/O.

## Config

```yaml
- id: llm-openai-compatible-managed
  name: '@deepseek-ai/dsh-llm-openai-compatible-managed'
  config:
    provider: managed
    displayName: Managed Model Gateway
    baseURLEnv: MODEL_GATEWAY_BASE_URL
    apiKeyEnv: MODEL_GATEWAY_API_KEY
```

`baseURLEnv` names the trusted launch-environment entry containing an HTTP or HTTPS OpenAI-compatible API root. Startup resolves it with `apiKeyEnv`, requests `<baseURL>/models`, rejects an empty or duplicate catalog, and registers exactly the returned ids through the pi-ai adapter. Model names and capacities are retained when the listing supplies them; otherwise pi-ai's managed-route defaults apply.

The API key is resolved again for every model request through `ctx.credentials`, or through the immutable launch environment when that seam is absent. The catalog itself is fixed for the process lifetime; a gateway model rollout takes effect after restarting the host.

## Model Experience

### Managed gateway request

#### What the model sees

The selected `provider: managed` model receives the harness-assembled system prompt, history, and tool schemas without adapter-authored prompt text. The package changes routing and catalog authority only.

#### Token effect

Token usage is determined by the selected gateway model and the pi-ai adapter's request translation; this package adds no prompt tokens.

#### KV Cache effect

The package preserves an unchanged assembled prefix. Changing the selected gateway model selects a different provider cache domain; restarting after a gateway catalog change does not otherwise rewrite prompt content.

## Known Limitations and Deferred Work

- **Catalog changes require restart** - the gateway listing is intentionally sampled once so no user-controlled settings path can replace the managed model set.
- **OpenAI-compatible protocol only** - gateways that require another wire protocol need a separate managed adapter. LiteLLM is one supported implementation, not a requirement.
