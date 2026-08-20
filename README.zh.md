<h1 align="center">Harness Enterprise</h1>

<p align="center">
  <strong>面向企业内部管控的 DeepSeek Harness 统一智能工作台入口。</strong><br>
  整合企业认证、AI Hub 策略、授权能力、审计接入和加固后的桌面运行环境。
</p>

<p align="center"><sub>本项目基于 DeepSeek Harness，由社区独立维护，与 DeepSeek AI 不存在隶属、合作、授权或背书关系。</sub></p>

[English](README.md) | 中文

## 项目定位

Harness Enterprise 保留标准 DeepSeek Harness 运行时，并增加一个可选的企业托管桌面发行层。它适合需要统一内部 AI 工作入口，同时又要管理身份、模型接入、MCP、Skill、客户端插件、企业指令、升级和对话审计的组织。

本项目不是身份提供方、终端 MDM、业务数据代理，也不会替代下游系统自身的数据权限。AI Hub 管理客户端能够发现和使用哪些能力；业务系统仍负责最终的数据授权。

## 组成

| 组件 | 职责 |
| --- | --- |
| 标准 Harness | 保留上游 Web、Host、Agent、工具和插件运行时，用户可以配置受支持的第三方模型。 |
| Harness Enterprise Desktop | 提供 Electron 桌面封装、企业登录、Hub 同步、本地运行时加固、受管升级和本地个人记忆。 |
| [DSH AI Hub](https://github.com/bloodtmai-cmyk/dsh-ai-hub) | 配套控制面，管理授权、模型访问记录、受管制品、企业指令、客户端版本和审计。 |
| Enterprise Gateway | 可替换的认证与 MCP 网关，在 `tools/list` 和 `tools/call` 阶段验证身份并执行 Hub 当前策略。 |

## 配套项目

企业托管部署将本桌面端与 [DSH AI Hub](https://github.com/bloodtmai-cmyk/dsh-ai-hub) 配合使用。Hub 维护策略和制品元数据，Harness Enterprise 作为面向用户的运行时消费这些决策。两者是可独立开发和部署的服务，但企业托管契约会协同设计。

## 模型接入

两种模式明确分开：

- 标准 Harness 保留原生第三方 Provider、Base URL 和 API Key 配置。
- 企业托管桌面不允许手工填写模型凭据，Provider 标识、OpenAI 兼容网关地址和 API Key 必须来自同一份 AI Hub 授权。
- 本机缓存 Key 只有在 Hub 仍返回有效授权和完整地址元数据时才能使用。
- LiteLLM 可以作为网关实现，但不是系统前提。

具体安全与运行约束见[桌面端说明](apps/desktop/README.md)。

## 从源码运行

需要 Node.js 24 和 pnpm 11.7.0：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

标准 Web UI 默认监听 `http://127.0.0.1:3080`。运行企业托管桌面还需要准备 AI Hub、企业 Gateway 和 OpenAI 兼容模型端点：

```sh
pnpm run desktop:dev
```

本仓库只发布源码，不提供已签名的 macOS 或 Windows 安装包。

## 开发与检查

```sh
pnpm run typecheck
pnpm test
pnpm run verify-third-party-notices
pnpm run verify-translation-pairing
pnpm run verify-community-sanitization
```

开发前可阅读[开发指南](docs/development.md)和[架构文档](docs/architecture.md)。

## 上游与许可证

核心运行时来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并保留其 MIT 署名。本仓库由 `clanie` 独立维护。

项目采用 [MIT License](LICENSE)。第三方依赖条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。
