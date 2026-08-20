# Agent Note：桌面企业个人页与显式退出登录

状态：已实现

[English](2026-08-20-desktop-enterprise-account-settings.md) | 中文

## 问题

受管桌面应用会在启动前完成企业用户认证，但设置中没有位置可检查当前运行会话绑定的身份，也没有显式结束会话的入口。若直接在浏览器侧增加普通账号模型，还可能暴露 OAuth 凭据，或错误接受 Renderer 提供的身份值。

## 决策

- 增加由窄化 preload 桥支撑、仅桌面端可见的**个人**设置分区。页面首先展示可信工号、认证方式、会话有效期，以及已验证 WorkBuddy JWT 中实际存在的 LDAP 或 SSO 可选属性。
- 在 Electron OAuth 客户端验证并清理身份 Claim。Renderer 不会获得 Access Token、Refresh Token、密码、LiteLLM Key、issuer 控制权或调用方提供的工号。
- 退出登录保持为带内联确认的显式破坏性操作。主进程校验 IPC 发送者，要求 Token Broker 撤销它持有的最新会话，只记录不含凭据的诊断信息，并重新启动回受管登录页。
- 远程撤销采用尽力而为语义。网络或 Provider 故障不能保留本地已登录进程；Electron 仍会退出并清除内存会话，加密本地数据继续按工号隔离。

## 验证

- OAuth 测试覆盖签名身份提取、重复部门代码归一化、刷新时属性保留和 Refresh Token 撤销。
- 组件测试覆盖完整与最小个人信息、内联退出确认、重试和失败状态。
- 桌面装配测试固定 preload IPC 表面、发送者绑定 Handler、包注册和重新启动生命周期。定向 TypeScript 构建与 GUI 测试覆盖组装后的客户端包。

## 结果

个人页只能展示认证 Provider 签发的信息。当前 Token 始终提供工号；Provider 后续补充对应 Claim 后，更丰富的目录信息会自动出现，而无需扩大 Renderer 权限。退出登录会按设计重新启动应用，使每个 Host、MCP、Skill、记忆和 API Key 绑定都在新认证的工号下重新构建。
