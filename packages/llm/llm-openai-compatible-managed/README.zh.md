# `@deepseek-ai/dsh-llm-openai-compatible-managed`

[English](README.md) | 中文

这个部署适配器根据 OpenAI 兼容网关的 `GET /models` 响应注册唯一的 `managed` Provider。它不公开 settings 命名空间或 configurable-provider 目录，因此发现结果是进程内完整的模型权威列表，任意手写模型 id 会在网络请求前以 `UNKNOWN_MODEL` 失败。

## 配置

```yaml
- id: llm-openai-compatible-managed
  name: '@deepseek-ai/dsh-llm-openai-compatible-managed'
  config:
    provider: managed
    displayName: Managed Model Gateway
    baseURLEnv: MODEL_GATEWAY_BASE_URL
    apiKeyEnv: MODEL_GATEWAY_API_KEY
```

`baseURLEnv` 用来指定保存 OpenAI 兼容 API 根地址的受信启动环境项，该地址必须使用 HTTP 或 HTTPS。启动时会同时解析它与 `apiKeyEnv`，请求 `<baseURL>/models`，拒绝空列表或重复模型，并通过 pi-ai 适配器只注册返回的 id。列表提供的模型名称和容量会被保留；未提供时使用 pi-ai 的托管路由默认值。

每次模型请求都会通过 `ctx.credentials` 重新解析 API Key；未挂载该能力时则读取不可变的启动环境。模型目录在进程生命周期内保持不变；网关上线新模型后需要重启宿主才能生效。

## 模型体验

### 托管网关请求

#### 模型看到什么

所选 `provider: managed` 模型会收到 Harness 组装的系统提示词、历史记录和工具 schema，本包不会添加提示文本。它只改变路由和模型目录的权威来源。

#### Token 影响

Token 用量由所选网关模型及 pi-ai 适配器的请求转换决定；本包不增加提示 token。

#### KV Cache 影响

本包会保留未变化的组装前缀。切换网关模型会进入不同的 Provider 缓存域；网关目录变化后的重启不会以其他方式改写提示内容。

## 已知限制与延期工作

- **目录变化需要重启** - 网关列表刻意只在启动时采样，以确保没有用户可控的 settings 路径能够替换托管模型集。
- **只支持 OpenAI 兼容协议** - 需要其他线协议的网关应由独立的托管适配器承接。LiteLLM 是可选实现，不是前提。
