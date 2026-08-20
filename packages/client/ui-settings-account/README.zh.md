# 企业账号设置

[English](README.md) | 中文

当 context-isolated preload 暴露窄化的企业账号桥时，`@deepseek-ai/dsh-client-ui-settings-account` 会向系统设置贡献仅桌面端可见的**个人**分区。页面展示当前登录工号、认证方式、会话有效期，以及已验证 WorkBuddy Access Token 中实际存在的可选目录属性。缺少的可选属性直接省略，不进行推断。

该分区提供带内联确认的退出登录操作。Electron 会尽力撤销 Token Broker 持有的当前会话，重新启动应用并返回受管登录页。Renderer 不会获得 Access Token、Refresh Token、LDAP 密码、LiteLLM Key 或文件系统路径。

## 模型体验

### 设置贡献

#### 模型看到的内容

无。本包只通过 IPC 呈现清理后的会话身份，不增加提示词内容或工具。

#### Token 影响

无。浏览器端贡献不组装也不发送模型请求。

#### KV Cache 影响

无。查看个人页或退出登录不会改变模型请求。

## 已知限制与延期工作

- **仅桌面端** - Electron preload 桥不可用时不显示该分区。
- **Provider Claim** - 姓名、部门、岗位、邮箱和手机只有在当前认证 Provider 将其写入已签名 Access Token 后才会出现。
