# RisuAI ST Compatibility

[RisuAI](https://github.com/kwaroran/Risuai) Windows 桌面端的第三方 SillyTavern 兼容补偿层。在原生聊天界面中运行带世界书、正则、变量和前端面板的酒馆角色卡。

**当前为实验版，实机验证版本为 RisuAI 2026.10.220 / Windows x64。** 兼容范围见 [兼容说明](docs/compatibility.md)。

## 工作方式

项目由 RisuAI API v3 插件、Node.js 运行层和本仓库的 `RisuRuntimeLoader.dll` 组成。插件提供角色卡预览、导入和连接设置；运行层接入原生聊天流程，兼容算法在 Worker 中执行，卡片前端在消息面板中运行。

安装器在目标 `RisuAI.exe` 的 PE 导入表中增加本项目 DLL 入口，保存安装前备份。**EXE 文件与哈希会改变**，原入口、代码、资源和已有导入保留。安装后直接启动该 EXE，DLL 自动启动后台助手；客户端退出时助手结束。无需编译 RisuAI。

RisuAI 官方提供 [插件 API](https://github.com/kwaroran/Risuai/blob/main/plugins.md)。本项目还使用内部接口桥接原生聊天，升级客户端后可能需要适配。仅导入插件 JS 不能完成运行层安装。

## 安装

需要 Windows x64、Node.js 22.12 或更高版本、Python 3、PowerShell 7，以及已安装的 RisuAI。安装依赖需要联网。

1. 从 [Releases](https://github.com/GuraQwQ/RisuAI-ST-Compatibility/releases) 下载 Windows x64 ZIP，解压到准备长期保留的目录。ZIP 包含源码与预编译 DLL。
2. 正常退出 RisuAI。在解压目录打开 PowerShell 7，指定实际客户端路径：

   ```powershell
   ./install.ps1 -Target 'D:\Apps\RisuAI\RisuAI.exe'
   ```

3. 直接启动该 `RisuAI.exe`。在原生设置中打开“酒馆运行层”，选择 JSON、PNG 或 CHARX 卡片，预览后导入。
4. 默认连接为“本地固定回复”，可用于检查卡片面板与变量；选择“Risu 当前主模型”并保存当前角色连接后，才会使用客户端配置的模型。

运行期间请保留项目目录、Node.js 和 Python 的安装位置。移动项目或更换 Node.js 后，退出客户端并重新执行同一安装命令。已有依赖与发行 DLL 时，也可执行：

```powershell
npm run install:runtime -- --target 'D:\Apps\RisuAI\RisuAI.exe'
```

安装会自动配置插件入口。导入通过原文件内容哈希识别重复操作，原卡字段与原始文件保留；日常输入、编辑、重生成、候选切换和停止继续使用 RisuAI 原生界面。

## 更新、恢复与数据

官方更新替换 EXE 后，再执行 `install.ps1` 恢复加载入口。更新本项目时，解压新版并指向同一个客户端重新安装；若升级后内部接口不兼容，需要等待本项目适配。

安装状态与恢复备份位于客户端目录的 `.risu-runtime-loader`。退出客户端后可以查看状态或卸载入口：

```powershell
python packages/loader/installer.py status --target 'D:\Apps\RisuAI\RisuAI.exe'
python packages/loader/installer.py uninstall --target 'D:\Apps\RisuAI\RisuAI.exe'
```

卸载按安装记录恢复程序。多个导入表工具叠加安装时，按相反顺序卸载；维护更早安装的工具前先卸载本入口，完成后重新安装。签名 PE、节表空间不足或已被其他工具改动的目标，处理规则见 [加载器说明](packages/loader/README.md)。

兼容角色与聊天保存在 RisuAI 自身数据库中。项目目录的 `data/runtime` 保存原卡、导入记录、插件配置备份、冲突记录和日志。备份时应同时保留 RisuAI 数据和该目录；迁移到另一份项目目录时一并转移 `data/runtime`。`npm run clean` 清理项目缓存，保留运行数据与安装备份。

## 源码构建

GitHub 的源码下载包需要自行构建 DLL。使用已有 Rust x64 MSVC 工具链，运行：

```powershell
./install.ps1 -Target 'D:\Apps\RisuAI\RisuAI.exe' -RustcPath (Get-Command rustc).Source
```

仅构建、不安装到客户端：

```powershell
npm ci --ignore-scripts
npm run build
./packages/loader/build.ps1 -RustcPath (Get-Command rustc).Source
```

构建只涉及本项目脚本和 DLL。原生组件使用系统函数与工具链中的 `rust-lld`，不需要额外 C++ SDK 或 Cargo 依赖。发布流程见 [发布说明](docs/releasing.md)。

可选的角色卡发现命令：

```powershell
npm run search:complex-cards -- 'SillyTavern character card' --min-world-entries 20
```

搜索会读取候选卡并汇总结构、外部脚本依赖和许可链接。角色卡内容的授权需要单独核实。

## 许可与反馈

整体采用 [AGPL-3.0-or-later](LICENSE)，原生加载器组件采用其目录中的 [MIT 许可](packages/loader/LICENSE)。抽取的 SillyTavern 与 MVU 算法保留原许可和固定提交来源，见 [第三方说明](THIRD_PARTY_NOTICES.md)。本项目由第三方维护。

遇到问题请在 [Issues](https://github.com/GuraQwQ/RisuAI-ST-Compatibility/issues) 提供客户端版本、复现步骤与相关错误日志。分享日志前检查其中的角色内容和个人信息。
