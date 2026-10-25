# 构建与发布

版本号由根目录 `package.json` 管理。RisuAI 插件头部的 `//@version` 应与其一致，打包时会校验。加载器源码采用 MIT，项目整体采用 AGPL-3.0-or-later，发行包携带对应源码和许可。

在已提交且工作区干净的 Git 仓库中执行：

```powershell
npm ci --ignore-scripts
npm run build
./packages/loader/build.ps1 -RustcPath (Get-Command rustc).Source
npm run package:release
```

输出位于 `dist/release`：Windows x64 ZIP 和 `SHA256SUMS.txt`。ZIP 从当前 Git 提交的文件清单生成，再加入刚构建的 `RisuRuntimeLoader.dll`。包内保留项目源码，依赖与浏览器脚本由用户安装时构建。源码包需要 Rust；Windows x64 ZIP 已包含 DLL。

主分支推送和手动运行触发 GitHub Actions 构建，并保存可下载的构建产物。发布与 `package.json` 匹配的 `v` 前缀标签时，同一工作流创建 GitHub 预发布版本，例如版本为 `0.3.0` 时使用标签 `v0.3.0`。发布说明来自 [release-notes.md](release-notes.md)，发布前按实际变更更新。

工作流只构建本项目。发布前在本地完成对应的行为验收、从干净源码验证安装链路，并确认兼容说明中的客户端版本。下载 ZIP 解压后，按根目录 README 执行安装。
