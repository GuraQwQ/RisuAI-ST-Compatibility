# 兼容范围

当前实机验证目标为 **Windows x64 / RisuAI 2026.10.292**，此前已验证 2026.10.220。项目以原生聊天操作为入口，补偿 SillyTavern 资源的运行语义。

| 能力 | 当前范围 |
| --- | --- |
| 角色卡 | JSON、带 `chara` / `ccv3` 文本区块的 PNG、含 `card.json` 的 CHARX；原文件、未知字段及资源保留 |
| 导入恢复 | 内容哈希识别重复导入，分阶段保存迁移记录，中断后重新导入可恢复 |
| ST 预设 | Chat Completion JSON、组合选择、条目开关与预设正则；模型和采样参数沿用 RisuAI 当前设置 |
| 独立世界书 | ST 世界书及角色世界书 JSON，内容哈希复用，按兼容角色多选保存 |
| ST 正则与宏 | 使用固定提交抽取的正则、默认宏与实验宏引擎；支持嵌套块宏、变量和字典读取，并提供对应的宿主上下文 |
| 世界书与提示词 | 关键词、递归、分组、时效与位置等由抽取引擎处理；本地固定回复模式使用字符数估算预算，非模型 tokenizer |
| MVU | 固定提交的变量初始化与更新算法、消息变量快照及回放；完整外部 MVU 扩展不在支持声明内 |
| 前端面板 | 消息内 HTML 面板及本项目实现的聊天、变量、事件接口子集；接口见 `packages/core/frontend-api.mjs` |
| 原生操作 | 输入、编辑、重生成、候选切换、停止及聊天存储继续通过 RisuAI 原生流程；普通文本使用当前客户端 Markdown 渲染，原生脚本、触发器与宏函数保留 |
| 模型连接 | 本地固定回复；Risu 当前主模型连接入口。后者会使用用户的模型配置 |

已用两张复杂前端卡完成本地验收，覆盖导入、面板交互、世界书、正则、变量更新和原生消息回读。验收未调用模型 API；角色卡样本与验收资料由开发环境单独管理。

真实模型请求、流式输出、群聊、任意 STscript 和完整 Tavern Helper / MVU / Zod 扩展组合尚未完成验收。卡片声明的远程脚本依赖会展示在预览中，解析成功并不代表这些依赖都能运行。请先用本地固定回复检查所需流程。

## 已验资源与对照条件

README 的兼容清单对应下列原始文件 SHA-256，文件内容变化后需要重新验证。

| 资源 | SHA-256 |
| --- | --- |
| Writer’s Block Unlimited V2 | `95adb346a3bac896db91f2de69b07c12c0ad30c2e155556ab0fb641e863b8e1d` |
| Voyage Universal v5.1 | `bcee744ec88e54d28622f50882e72cb3a190f89301dfe033071955f6a36ec1a2` |
| Nemo Engine v12.3 Standard | `5c0755a71d3d2a1b3b56399bca0afb05e2e5c2281c381531aa4393559d7592fa` |
| 青空 理（MVU update 版 PNG） | `31b86c7ffa13b3978abf33b50a57e4bc99a787d0419783943b6cf386168b273a` |
| ArtificRealm v1.0.1 PNG | `6a9441fe08ec0bafd9fb481af37cbac48a82c8071532c0a0907109ebffc93191` |

对照基准为 SillyTavern 1.19.0，源码提交 `7e8663cd9c184a550b37238218bdd32c6efc68e9` 的原始浏览器模块。使用独立客户端数据，固定角色、历史、随机源、时间及相同预算计数器，全程使用本地固定回复。

- 预设：三套各验证两种 README 所列配置，共 6 个场景。最终消息数组、聊天变量与全局变量完全一致。
- 正则：三套预设与两张卡各验证 120 个场景，覆盖输入、AI 输出、世界书位置，显示、提示词、编辑及不同深度；结果完全一致。这是样例对照，不代表穷举每条表达式的所有分支。
- 世界书：从上述卡片原件提取内置书，分别为 13 与 121 条。在同一段历史与扫描设置下命中 11 与 43 条，命中条目标识、前后位置、深度、示例、作者注释及 outlet 输出完全一致。
- 实机：预设导入、条目搜索与开关保存、世界书重复导入与选用，以及角色前端面板的已验流程。客户端模型与采样设置和原有聊天记录按基线核对。

“完全兼容”限于这些确定性语义与已验流程。实际模型输出、不同 tokenizer 的预算裁剪，以及任意配置、外部脚本组合需要各自验证。

## 客户端升级

2026-10-30 已用官方 2026.10.292 Windows x64 安装包完成更新复验。现有 v0.3.0 运行层可直接接入；验证了 DLL 自动启动、两张大型卡的状态栏、Nemo 条目搜索与保存回读，以及原生聊天中的本地固定回复。更新前后的五个角色聊天、兼容配置、预设库、模型及采样参数核对一致。

2026-11-01 再次核对官方发布，最新版本仍为 2026.10.292。重建并重复安装 v0.3.0 后，EXE 哈希保持一致，两个 DLL 自动加载；五个角色的聊天和兼容配置保持一致，Nemo 条目搜索与保存、本地固定回复和两张大型卡面板复验通过。Node 回归 78 项、加载器回归 10 项通过。

插件设置入口使用官方 API v3；原生聊天接线还依赖客户端内部模块结构与调试接口。上游 [API v3 定义](https://github.com/kwaroran/Risuai/blob/main/src/ts/plugins/apiV3/risuai.d.ts) 明确说明，未列出的内部接口可能随时变化。

因此，官方更新替换 EXE 后需要重新安装 DLL 入口；若聊天模块结构变化，还需更新本项目适配代码。重新安装入口通常不需要重编译 RisuAI，但不保证所有未来版本即装即用。当前没有验证浏览器版、移动端、macOS、Linux 或 Windows ARM64。

## 提示词模板与前端助手

2026-11-01 对照两个上游项目的文档、接口与本项目源码，当前均为部分适配。

| 项目 | 已实现 | 尚未接入 |
| --- | --- | --- |
| [ST-Prompt-Template](https://github.com/zonde306/ST-Prompt-Template/tree/d6f520d149aba146305b0b781ddd691d449c28d2) | 同步 EJS 条件、循环、输出；简单 `getvar/setvar`、`variables/user/char` 与 lodash；部分世界书和提示词处理 | 异步模板、`print`、完整 helper 与变量作用域、世界书 include、`[GENERATE:*]` / `[RENDER:*]` / `@INJECT` / `[InitialVariables]`、完整消息渲染及 `EjsTemplate` 环境 |
| [JS-Slash-Runner / Tavern Helper](https://github.com/N0VI028/JS-Slash-Runner/tree/5cbd089f1217d00e1f6851f50bf451223860a9c2) | 消息 HTML iframe；部分聊天编辑、变量、事件、localStorage 与 MVU；简单生成入口 | 完整 `TavernHelper` 命名空间与脚本依赖、聊天增删、完整世界书/预设/角色/正则/Slash 接口、原生事件生命周期、raw 提示词、生成覆盖与注入、流式和取消接口 |

模板处理见 `packages/core/session.mjs` 和 `packages/core/operation.mjs`：目前只调用同步 `ejs.render`；输出阶段可以执行变量副作用，但返回正文仍可能保留原始 EJS 标签。前端接口见 `packages/core/frontend-api.mjs` 与 `packages/runtime/page.mjs`：`generateRaw` 当前复用普通生成路径，不处理上游的 `ordered_prompts`、`overrides`、`injects` 等配置。世界书读取也尚未完整匹配上游的名称和绑定语义。

现有测试与两张大型卡覆盖的是已实现子集；尚未进行这两个上游项目的完整一致性验收。

接入失败时查看项目 `data/runtime/launcher.log`，DLL 启动失败时查看 EXE 旁的 `RisuRuntimeLoader.log`。保留原始记录后，可以重复安装、重新启动客户端重试。
