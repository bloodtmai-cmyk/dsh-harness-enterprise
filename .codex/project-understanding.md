# 项目理解

## 项目定位

- 本仓库是 DeepSeek Harness 及其 Electron 桌面发行版；社区脱敏分支为 `codex/community-open-source`。
- 社区项目定位是企业内部管控下的统一智能工作台入口，不宣称替代身份系统、MDM、业务数据权限或下游系统。
- 社区代码不得包含特定企业名称、Logo、域名、IP、账号、业务系统地址、生产数据或未获再分发授权的内部制品。
- 桌面参考发行版统一显示为 `Harness Enterprise Desktop`，社区默认图标使用仓库内通用 Harness 图标。

## 两种模型接入模式

- 标准 Harness 保留原生模型设置页，可由用户配置受支持的第三方 Provider、Base URL 和 API Key。
- 企业托管桌面不显示手工模型凭据入口。用户完成企业认证后，AI Hub 一次性下发模型 API Key，并持续提供 Provider 标识与 OpenAI 兼容模型网关地址；地址和 Key 必须来自同一份 Hub 授权记录。
- 本机缓存 Key 只有在 Hub 当前授权仍有效且 Hub 返回完整 Provider 与网关地址时才可使用；旧授权缺少地址元数据时默认拒绝，必须由管理员重新签发。
- LiteLLM 是可选的企业模型网关实现，不是产品前提。桌面托管适配器使用 `MODEL_GATEWAY_*` 环境变量；`LITELLM_*` 只作为旧版插件迁移期的兼容别名，且变量值仍全部来自 Hub 管理面。
- 企业托管凭据只写入操作系统安全存储，不进入 Renderer、日志、命令行参数或普通设置文档；领取后 Hub 只保留密文、哈希与掩码。

## 企业认证与能力治理

- Electron 登录通过 OAuth Authorization Code + PKCE 连接可配置的企业 Gateway；默认端点仅用于本地开发。
- Gateway JWT 必须验证签名、issuer、audience，并把已验证的员工标识绑定到 API Key、审计和 MCP Tool 调用。模型和用户输入不能覆盖该身份。
- 身份认证与能力授权分离：缺少某项 MCP/Skill/Bundle 权限不能阻止登录；Gateway 在 `tools/list` 和 `tools/call` 阶段默认拒绝未授权能力。
- MCP、Skill、Bundle、客户端插件、企业指令和桌面升级均由 AI Hub 管理。普通 Tool 随所属 MCP 发布和授权，可在 MCP 详情中单独排除。
- 企业指令来自 Hub 的只读版本化制品，优先级高于本地指令；标准社区 Harness 仍保留原有本地指令能力。

## 桌面安全边界

- Electron 只在随机 `127.0.0.1` 端口启动 Web 后端，并用每次启动生成的 Bearer Token 保护静态资源、API 和 WebSocket；普通浏览器不能直接复用该入口。
- Renderer 禁用 Node 集成，启用 context isolation 与 sandbox。外部导航只允许用户明确触发的 HTTP(S) 链接。
- 个人长期记忆保存在本机并由操作系统凭据加密，按可信员工标识和工作区隔离；不上传 Hub，不接受模型任意写入，也不能覆盖企业策略。
- Skill、企业指令和 MCP/Tool 目录可热更新；客户端插件必须声明受管热激活生命周期。二进制升级仍由用户选择立即安装或下次启动安装。

## 配置与运行

- Electron 应用位于 `apps/desktop`，受管覆盖层为 `apps/desktop/config/desktop.patch.yml`。
- 社区部署通过受信进程环境配置 `AI_HUB_BASE_URL`、`WORKBUDDY_ISSUER`、`WORKBUDDY_MCP_URL` 和 `WORKBUDDY_REDIRECT_URI`；不得把这些入口重新暴露为企业终端用户可编辑项。
- 企业托管运行时将 Hub 下发的模型网关地址和 Key 投影到内部 OpenAI 兼容适配器；标准 Harness 的第三方模型配置不经过该登录门禁。
- 本地开发默认 AI Hub 为 `http://127.0.0.1:8090/ai-hub`，模型网关为 `http://127.0.0.1:4000/v1`，企业 Gateway 为 `http://127.0.0.1:8090/enterprise-gateway`。

## 开源交付约定

- 每次公开前运行 `scripts/verify-community-sanitization.sh`，并检查 Git 历史是否仍含敏感内容；工作树脱敏不等于历史脱敏。
- 公开前必须确认第三方依赖许可证、NOTICE/SBOM、品牌与商标使用、示例凭据、截图和二进制制品的再分发权限。
- 内部脱敏分支不直接连接公共远端；公开发布从审查后的索引导出到全新仓库，确保不携带内部 Git 历史。
- 公开仓库只发布源码，不发布 macOS/Windows 安装包；维护者为 `clanie`，安全联系邮箱为 `bloodtmai@gmail.com`。
