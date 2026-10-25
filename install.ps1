#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$Target,
    [string]$RustcPath
)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
Push-Location -LiteralPath $projectRoot
try {
    $env:npm_config_cache = Join-Path $projectRoot 'cache/npm'
    & npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE) { throw '项目依赖安装失败，可重复执行 install 重试。' }
    if ($RustcPath) {
        & (Join-Path $projectRoot 'packages/loader/build.ps1') -RustcPath $RustcPath
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'packages/loader/dist/RisuRuntimeLoader.dll'))) {
        throw '请先构建 packages/loader，或放入对应发行版 DLL 后重试。'
    }
    & node scripts/install.mjs --target $Target
    if ($LASTEXITCODE) { throw '运行层安装失败。' }
} finally { Pop-Location }
