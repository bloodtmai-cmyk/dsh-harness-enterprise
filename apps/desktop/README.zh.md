# Harness Enterprise Desktop

[English](README.md) | 中文

这是 DeepSeek Harness 的 Electron 企业托管参考发行版。它负责企业认证、AI Hub 策略同步、模型访问校验、桌面升级和加固后的本地 Web 运行时。

## 模型接入模式

仓库保留两种明确分开的模式：

- 标准 Harness 使用原生模型设置页，用户可以配置受支持的第三方 Provider、Base URL 和 API Key。
- 企业托管桌面隐藏手工凭据入口。AI Hub 审批记录同时保存 Provider 标识、OpenAI 兼容模型网关地址和 API Key；客户端完成企业认证后从 Hub 领取 Key，并持续从 Hub 获取对应地址。

本机缓存的托管 Key 只有在 Hub 仍返回有效授权、Provider 和完整网关地址时才能使用。缺少地址元数据的旧授权默认拒绝，必须由管理员重新签发。

LiteLLM 可以作为企业网关实现，但不是必选依赖。托管适配器使用 `MODEL_GATEWAY_BASE_URL`、`MODEL_GATEWAY_API_KEY` 和 `MODEL_GATEWAY_DEFAULT_MODEL`；已废弃的 `LITELLM_*` 别名仅用于兼容旧版受管插件。

## 企业配置

社区部署通过受信的进程环境或部署 Secret 配置以下入口：

```text
AI_HUB_BASE_URL=http://127.0.0.1:8090/ai-hub
WORKBUDDY_ISSUER=http://127.0.0.1:8090/enterprise-gateway
WORKBUDDY_MCP_URL=http://127.0.0.1:8090/enterprise-gateway/mcp
WORKBUDDY_REDIRECT_URI=workbuddy://enterprise-gateway/mcp/oauth/callback
```

这些配置不应暴露为企业终端用户可编辑项。示例只适用于本机开发；生产必须使用受信 HTTPS 域名、正确的 OAuth 客户端注册以及匹配的 JWKS、issuer 和 audience。

## 身份与能力

登录使用 OAuth Authorization Code + PKCE。密码只发送到认证 Provider，不写入文件、日志或 Renderer。JWT 中的员工标识必须与登录输入一致，并作为 API Key、审计、个人记忆和 MCP 权限的可信身份。

认证与授权相互独立。缺少 MCP、Skill、Bundle 或插件权限不会阻止登录；Gateway 在 `tools/list` 和 `tools/call` 阶段按 Hub 当前策略过滤能力。企业指令、Skill、MCP/Tool 目录和声明为 `activation=hot` 的客户端插件可在运行中更新。

## 本地安全

- 模型 Key 通过 Electron `safeStorage` 写入操作系统安全存储，Renderer 和普通设置文档不可读取。
- 本地 Web 后端只监听随机 `127.0.0.1` 端口，并要求每次启动生成的 Bearer Token；普通浏览器无法直接访问。
- Renderer 启用 context isolation 与 sandbox，禁用 Node 集成；仅允许用户明确点击的 HTTP(S) 外部链接。
- 个人长期记忆只保存在本机，按可信员工标识和工作区隔离，不上传 AI Hub，也不能覆盖企业策略。

## 开发

```bash
pnpm --filter @deepseek-ai/dsh-desktop test
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop build
```

运行桌面端前需要准备 AI Hub、企业 Gateway 和一个 OpenAI 兼容模型端点。标准 Harness 的第三方模型配置不依赖这些企业服务。

## 打包与发布

打包流程会校验 Host、Client、CLI、原生依赖和受管插件的运行时闭包。macOS 正式分发需要 Developer ID 签名与公证；Windows 建议使用签名的 NSIS 安装包。桌面更新制品由 AI Hub 发布，客户端可选择立即安装或下次启动安装。

公开发布前运行仓库根目录的 `scripts/verify-community-sanitization.sh`，并审查许可证、NOTICE/SBOM、截图、二进制制品及 Git 历史。社区分支不会自动推送到公共远端。
