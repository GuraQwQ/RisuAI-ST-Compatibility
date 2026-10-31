# 第三方代码与许可

本项目整体采用 AGPL-3.0-or-later。以下源码随仓库和发行包提供，保留其来源与许可。

| 组件 | 来源与版本 | 本地许可与来源记录 |
| --- | --- | --- |
| SillyTavern 算法抽取与适配 | [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern/tree/7e8663cd9c184a550b37238218bdd32c6efc68e9)，提交 `7e8663cd9c184a550b37238218bdd32c6efc68e9` | [AGPL-3.0](packages/core/vendor/LICENSE-ST)、[文件与符号记录](packages/core/vendor/sources.json) |
| SillyTavern 实验宏引擎与宏定义 | 同上固定提交；lexer、parser、walker、registry 及核心、变量、环境、时间、聊天宏 | [AGPL-3.0](packages/core/vendor/LICENSE-ST)、[原文件哈希](packages/core/vendor/modern-sources.json) |
| MVU 变量算法抽取与适配 | [MagicalAstrogy/MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate/tree/54be11b09f21b1c4266e2d54b6f1ba9a3598db05)，提交 `54be11b09f21b1c4266e2d54b6f1ba9a3598db05` | [MIT](packages/core/vendor/LICENSE-MVU)、[文件记录](packages/core/vendor/mvu-sources.json) |
| ST-Prompt-Template 模板 helper 与变量算法 | [zonde306/ST-Prompt-Template](https://github.com/zonde306/ST-Prompt-Template/tree/d6f520d149aba146305b0b781ddd691d449c28d2)，提交 `d6f520d149aba146305b0b781ddd691d449c28d2` | [AGPL-3.0](packages/core/vendor/LICENSE-ST)、[原文件哈希](packages/core/template-primitives.mjs)、[抽取脚本](scripts/vendor-template.mjs) |
| 原生加载器 | 本项目 `packages/loader` | [MIT](packages/loader/LICENSE) |

`packages/core/vendor` 中的文件是针对本运行层抽取、拼接和接入宿主上下文后的版本。修改后的可读源码随发行包提供，原始文件哈希与抽取范围见上述来源记录。

兼容目标 [RisuAI](https://github.com/kwaroran/Risuai) 采用 GPL-3.0。用户自行取得官方客户端；本项目发行包提供本项目源码及加载器 DLL。

Tavern Helper 风格接口按公开接口契约独立实现，未打包 JS-Slash-Runner 的实现代码。角色卡可能另行依赖外部扩展、远程资源或脚本，这些依赖及角色内容的授权由各自作者规定。

Node.js 依赖在安装时通过 `npm ci` 取得，版本和完整性值记录在 `package-lock.json`，各依赖的许可随对应软件包提供。发行 ZIP 中的源码与 DLL 可独立核对，浏览器脚本在安装时由这些依赖本地构建。

模板适配使用 YAML、Zod、jsonrepair 与 Faker 执行上游 helper；前端脚本复用 jQuery、Vue、Vue Router、JSON5、klona 和 toastr。维护者升级模板或前端接口时同步更新这些依赖并运行相应回归。
