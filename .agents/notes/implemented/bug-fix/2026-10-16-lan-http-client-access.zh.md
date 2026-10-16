# Agent Note: 内网 HTTP 客户端访问

Status: implemented

[English](2026-10-16-lan-http-client-access.md) | 中文

## Problem

浏览器通过纯 HTTP 访问内网部署时不提供 `crypto.randomUUID`。RPC 关联、消息构造和附件草稿仍需生成随机标识。可信内网地址调用仅限回环访问的配置接口时，也会收到不明确的 403 响应。

## Decision

浏览器可达的 UUID 调用点统一使用 `uuid` v4，包括已有 Connection 辅助函数。安全上下文的 `randomUUID` 不存在时，其浏览器实现使用 `crypto.getRandomValues`；Node 则解析到 Node 实现。各消费包显式声明依赖，工作区锁文件固定版本。

特权 API 保留回环和同源检查。请求通过通用 Host 检查后，特权拒绝返回 HTTP 403，JSON 错误码为 `loopback-required`，`x-dsh-error-code` 响应头携带相同值。两个单次请求客户端将该标记转换为可操作的本机访问说明，不回显任意响应正文。远程设置页通过现有通用设置项插槽显示本地化提示。

## Alternatives considered

**全局 polyfill：** 修改 `crypto` 或向生成的 HTML 注入脚本会隐藏各包对安全上下文的依赖，也不能覆盖其他浏览器入口。

**远程特权开关：** 可信 Host 用于防御 DNS 重绑定，不是用户认证。不引入认证层就扩大凭据和预设管理权限，并非解释现有限制所必需。

## Consequences

内网 HTTP 可以承载普通 RPC，但配置管理仍需在服务器本机浏览，或通过 SSH 本地端口转发访问 `127.0.0.1`。HTTPS 本身不授予特权。Host 拒绝仍返回不透明的 403；只有已接受的地址会收到特权诊断。普通远程会话操作仍能运行工具，因此这不是多用户安全边界。

## Testing

定向测试覆盖消息构造、附件草稿、RPC 标识生成、拒绝诊断，以及保留的 Host 拒绝。真实 Web 组装临时监听所有接口，在 Chromium 中通过本机非回环 IPv4 地址使用 HTTP 访问，确认安全上下文 API 不存在，并快照验证远程设置提示。此方式避免依赖外部 DNS；测试要求本机存在此类接口。其他场景的测试框架默认仍只监听回环。不需要模型凭据。
