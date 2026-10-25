# 运行层加载器

本仓库的原生启动组件，生成 `RisuRuntimeLoader.dll`。只负责为当前进程准备 WebView2 连接、启动配置指定的后台助手；兼容算法继续由 `packages/core` 与 `packages/runtime` 实现。

支持 Windows x64。使用 PE 导入表增加 DLL 加载入口，保留原入口、已有导入、代码与资源节。配置与助手不加载到其他应用进程。

## 构建

需要已有的 Rust x64 MSVC 工具链及其 `rust-lld`。构建脚本使用 raw-dylib 和 Windows 系统函数，不需要额外安装 C++ SDK、Cargo 包或 C 运行库。

在仓库根目录的 PowerShell 7 中运行：

```powershell
./packages/loader/build.ps1 -RustcPath (Get-Command rustc).Source
```

DLL 写入 `packages/loader/dist`，编译临时文件在 `packages/loader/build`。这些产物均已忽略，不进入 Git。加载器源码采用本目录的 MIT 许可，整个兼容项目的许可见仓库根目录。

## 安装和恢复

安装目标可单独指定；以下命令从仓库根目录运行：

```powershell
npm run install:runtime -- --target '完整的 RisuAI.exe 路径'
python packages/loader/installer.py status --target '完整的 RisuAI.exe 路径'
python packages/loader/installer.py uninstall --target '完整的 RisuAI.exe 路径'
```

安装和卸载前正常退出客户端。安装生成 DLL 旁的 UTF-8 `RisuRuntimeLoader.ini`，用当前 Node 路径和本仓库助手脚本配置。配置格式见 [示例](RisuRuntimeLoader.example.ini)：`program` 为程序路径，`arguments` 为 Windows 命令行参数；相对路径以 DLL 目录为基准。DLL 自动追加 `--attach-pid <宿主 PID>`，并隐藏助手控制台。

安装状态和校验备份位于目标目录的 `.risu-runtime-loader`。安装先保存准备记录，再逐文件发布配置、DLL、EXE，最后提交状态；空目录、重复安装、部分发布、中断重试、缺失 DLL 和更新 DLL 都由同一个 install 处理。卸载按校验恢复安装前程序，只移除哈希属于本安装记录的文件；已修改配置会保留，官方已替换的 EXE 也会保留。

多个导入表工具叠加安装时，应按相反顺序卸载。维护更早安装的其他工具前，先卸载本加载入口；维护完成后再次 install。已有未知改动时保留文件并报告状态，不覆盖其他工具的修改。

官方更新替换 EXE 后，再执行 install 即可重新增加加载入口，不需要重编译 Risu。签名 PE 或节表无可用空间的文件会保留原件并报告原因。当前验证范围是 RisuAI 2026.10.220 x64。

## 启动顺序

1. Windows 在 EXE 入口前加载 DLL；DLL 保留已有 WebView 参数，缺少调试端口时设置 `--remote-debugging-port=0`。
2. DLL 创建启动线程并立即退出加载器回调；配置读取和进程启动在线程入口执行，不在加载器锁内等待。
3. 助手按宿主 PID 查询其 WebView，读取本次启动的 `DevToolsActivePort`；过期和未写完的端口文件会等待重试。
4. 助手连接现有客户端，不关闭或重新启动客户端。客户端退出后助手结束；重复接入复用同一会话。

DLL 自身故障写入旁边的 `RisuRuntimeLoader.log`；助手日志在本项目 `data/runtime/launcher.log`。配置缺失、编码无效或助手无法启动时，客户端继续正常启动。

`npm run clean` 同时清理本组件的编译和 Python 缓存，保留发行 DLL、原卡、聊天与安装备份。需要再次构建时运行上述构建命令。

实现依据：[PE 格式](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)、[DLL 加载约束](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices)、[WebView2 调试](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code)。
