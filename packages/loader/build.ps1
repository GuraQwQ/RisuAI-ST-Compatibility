#requires -Version 7.0
param([Parameter(Mandatory)][string]$RustcPath)
$ErrorActionPreference = 'Stop'
$RustcPath = (Resolve-Path -LiteralPath $RustcPath).Path
$buildDirectory = Join-Path $PSScriptRoot 'build'
$distributionDirectory = Join-Path $PSScriptRoot 'dist'
$temporaryDirectory = Join-Path $buildDirectory 'tmp'
New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $distributionDirectory -Force | Out-Null
$sysroot = & $RustcPath --print sysroot
if ($LASTEXITCODE) { throw '无法确定现有 Rust 工具链。' }
$linker = Join-Path $sysroot 'lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe'
if (-not (Test-Path -LiteralPath $linker)) { throw '需要现有 x64 Rust MSVC 工具链中的 rust-lld。' }
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
try {
    $env:TEMP = $temporaryDirectory
    $env:TMP = $temporaryDirectory
    $common = @('--edition=2021', '--target=x86_64-pc-windows-msvc', '-C', 'panic=abort', '-C', 'opt-level=s', '-C', 'lto=fat', '-C', 'codegen-units=1',
        '-C', "linker=$linker", '-C', 'link-arg=/NODEFAULTLIB')
    & $RustcPath @common --crate-type=cdylib -C link-arg=/ENTRY:DllMain `
        (Join-Path $PSScriptRoot 'src/loader.rs') -o (Join-Path $distributionDirectory 'RisuRuntimeLoader.dll')
    if ($LASTEXITCODE) { throw 'DLL 构建失败。' }
} finally { $env:TEMP = $originalTemp; $env:TMP = $originalTmp }
Get-Item -LiteralPath (Join-Path $distributionDirectory 'RisuRuntimeLoader.dll') | Select-Object Name,Length
