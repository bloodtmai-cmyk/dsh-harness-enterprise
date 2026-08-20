# Agent Note: 桌面端关于页版本

Status: implemented

[English](2026-08-19-desktop-about-version.md) | 中文

## 问题

Windows 没有 macOS 那种可显示 Electron“关于”对话框的应用菜单，因此桌面用户在反馈问题或核对升级时，无法从产品内可靠确认已安装的 Harness 版本。

## 决策

Electron 主窗口把 `app.getVersion()` 作为非敏感 Renderer 参数交给 context-isolated preload。preload 通过只读 `desktopAppInfo` 值暴露产品名与已安装版本。`ui-settings-general` 仅在该值存在时注册“关于”分区，使桌面应用版本与 Host 包版本保持区分，并让普通 Web Harness 设置页维持不变。

## 备选方案

**显示 Host 握手版本。**否决，因为用户实际安装和升级的是独立打包的 Electron 应用；Host 包版本可能不同，会错误标识 Windows 安装版本。

**依赖操作系统“关于”界面。**否决，因为 Windows 菜单配置不提供 macOS 风格的应用菜单，这正是版本不可见的原因。

## 结果

Windows 和 macOS 桌面用户可以在“设置 > 关于”中查看已安装版本。preload 只增加一个非敏感静态值，浏览器既接收不到桌面身份，也不会渲染“关于”入口。
