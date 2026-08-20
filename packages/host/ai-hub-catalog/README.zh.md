# AI Hub 目录 Host

[English](README.md) | 中文

`@deepseek-ai/dsh-host-ai-hub-catalog` 通过窄接口 Typert Remote，向可信 Web 客户端暴露 AI Hub 企业能力市场。

浏览器不会获得 Hub Token。Host 向桌面回环 Broker 申请短时 Token，解析实时菜单权限、获取已发布市场目录并提交能力申请。启动时的 `DSH_AI_HUB_CATALOG` 快照仍用于本地运行时投影，其中不包含密钥或传输字段。

不在受管桌面环境中运行时，Remote 会为目录和菜单权限返回不可用的空结果。格式错误或超过大小限制的快照会在插件挂载时失败关闭。

本包只调用配置好的 AI Hub 客户端 API，不下载制品、不调用 MCP Gateway，也不自行判断权限。

## 模型体验

无。本包只在 Host 侧投影目录，不注册提示词、工具、消息或模型请求。

#### KV Cache 影响

无；本包不会组装模型输入。

## 已知限制与延期工作

- **不拥有制品** - 下载、校验、安装和对账仍由 Electron 负责。
- **窄菜单契约** - 当前客户端契约只暴露 `PLUGIN_MARKET` 菜单键；其他企业菜单必须显式增加类型化契约。
- **不执行管理操作** - 发布、审批、授权、撤销和 Gateway 调用仍由各自所属系统负责。
