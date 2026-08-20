# @deepseek-ai/dsh-client-locale

[English](README.md) | 中文

locale 插件：LocaleRuntime——`zh`／`en` 偏好以 `locale.preference` 存储在 `$DSH_HOME/settings.yaml` 中；若没有显式 Host 值，全新浏览器会暂时使用 `navigator` 请求的语言（按主子标签匹配；若其请求的语言本应用都不提供，则使用 `zh`）。Host 读取在插件激活后执行，因此 settings 服务不可用不会阻塞页面；读取结果会实时替换浏览器暂定值。settings API 仅限回环请求，因此远程浏览器的选择仅保留在进程内。`locale/change` 仅在切换语言时触发。该服务还拥有 ns×locale 字典注册表（类型化 `register(ns, {zh, en})` 按 `LocaleNamespaceMap` 校验，`bind(ns)`→`TranslateNS<ns>`；查找链 ns → common → zh → key），实现 slot 系统的 `LocaleFace`，并经 `ctx.slots.installLocale` 自行安装，支撑框架注入的 `t` 标准席位（`Translate`／`TranslateNS` 是 ui-slots 的类型；请从那里导入——本包的再导出仅为字典所有者提供便利）。该持久化边界由[Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)拥有。

## 模型体验

### 托管桌面输出语言指令

#### 模型看到什么

托管桌面宿主设置 `DSH_OUTPUT_LANGUAGE_FROM_LOCALE=1` 后，一段指令会要求可见思考/推理、计划、工具说明和最终回答使用最新的 `locale.preference`。代码、命令、标识符、文件路径和引用原文保持原语言。默认组合不注册模型指令。

#### Token 影响

托管桌面请求增加一段固定的两句 system prompt，不增加工具 schema、工具结果或逐轮上下文条目。

#### KV Cache 影响

未切换语言时该指令保持稳定。热切换会从下一模型步骤开始改变 system prompt，因此该请求不能复用切换前的完整提示前缀。

## 已知限制与暂缓事项

- **部分界面仍保留内联文案**——设置行、侧边栏、问题作答器和模型选择使用 locale seat；其他包仍直接拥有静态文本。
- **注册表持有的文本只读取一次翻译**——在 slot 渲染路径之外于注册时捕获的文案（例如 command 注册表中的 `/model` 命令描述）在重新注册前保持注册时的语言；slot 渲染的文案随切换实时更新。
