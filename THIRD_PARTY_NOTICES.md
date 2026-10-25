# 第三方代码与许可

本项目整体采用 AGPL-3.0-or-later。以下源码随仓库和发行包提供，保留其来源与许可。

| 组件 | 来源与版本 | 本地许可与来源记录 |
| --- | --- | --- |
| SillyTavern 算法抽取与适配 | [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern/tree/7e8663cd9c184a550b37238218bdd32c6efc68e9)，提交 `7e8663cd9c184a550b37238218bdd32c6efc68e9` | [AGPL-3.0](packages/core/vendor/LICENSE-ST)、[文件与符号记录](packages/core/vendor/sources.json) |
| MVU 变量算法抽取与适配 | [MagicalAstrogy/MagVarUpdate](https://github.com/MagicalAstrogy/MagVarUpdate/tree/54be11b09f21b1c4266e2d54b6f1ba9a3598db05)，提交 `54be11b09f21b1c4266e2d54b6f1ba9a3598db05` | [MIT](packages/core/vendor/LICENSE-MVU)、[文件记录](packages/core/vendor/mvu-sources.json) |
| 原生加载器 | 本项目 `packages/loader` | [MIT](packages/loader/LICENSE) |

`packages/core/vendor` 中的文件是针对本运行层抽取、拼接和接入宿主上下文后的版本。修改后的可读源码随发行包提供，原始文件哈希与抽取范围见上述来源记录。

兼容目标 [RisuAI](https://github.com/kwaroran/Risuai) 采用 GPL-3.0。用户自行取得官方客户端；本项目发行包提供本项目源码及加载器 DLL。

Tavern Helper 风格接口由本项目实现为兼容子集。角色卡可能另行依赖外部扩展、远程资源或脚本，这些依赖及角色内容的授权由各自作者规定。

Node.js 依赖在安装时通过 `npm ci` 取得，版本和完整性值记录在 `package-lock.json`，各依赖的许可随对应软件包提供。发行 ZIP 中的源码与 DLL 可独立核对，浏览器脚本在安装时由这些依赖本地构建。
