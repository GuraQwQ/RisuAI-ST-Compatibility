"""安装独立运行层 DLL；状态和备份仅归当前目标程序所有。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from pe_patch import DLL_NAME, PE, add_import

ROOT = Path(__file__).resolve().parent
CONFIG_NAME = "RisuRuntimeLoader.ini"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    if digest(temporary.read_bytes()) != digest(data):
        raise OSError(f"写入校验失败，可重新安装：{path.name}")
    os.replace(temporary, path)


def paths(target):
    target = Path(target).resolve()
    directory = target.parent / ".risu-runtime-loader"
    return target, directory, directory / "install.json"


def state_for(target):
    target, directory, file = paths(target)
    if not file.exists():
        return None
    state = json.loads(file.read_text(encoding="utf-8"))
    if state["target"] != target.name:
        raise ValueError("安装记录指向其他主程序")
    backup = (directory / state["backup"]).resolve()
    if not backup.is_relative_to(directory.resolve()):
        raise ValueError("备份路径不属于本安装目录")
    return state


def file_hash(file):
    return digest(file.read_bytes()) if file.exists() else None


def has_loader(data):
    return any(name.lower() == DLL_NAME.lower() for name, _ in PE(data).imports())


def configuration(program, arguments):
    program = str(program)
    if not program or any(c in program for c in '\r\n\0"') or any(c in arguments for c in '\r\n\0'):
        raise ValueError("程序路径或参数包含无效字符")
    data = f"program={program}\narguments={arguments}\n".encode("utf-8")
    if len(data) >= 16384:
        raise ValueError("配置文件超过 DLL 读取大小限制")
    return data


def install(target, source, program, arguments):
    target, directory, state_file = paths(target)
    current = target.read_bytes()
    dll = Path(source).read_bytes()
    PE(dll)
    config = configuration(program, arguments)
    previous = state_for(target)
    destination = target.with_name(DLL_NAME)
    config_file = target.with_name(CONFIG_NAME)
    if has_loader(current):
        if not previous or digest(current) != previous["patched_sha256"]:
            raise ValueError("已有加载入口与安装记录不一致，已保留当前程序")
        original = (directory / previous["backup"]).read_bytes()
        if digest(original) != previous["base_sha256"]:
            raise ValueError("原程序备份校验失败，已保留现有文件")
        patched = current
    else:
        original = current
        patched = add_import(original)
    owned_dll = set(previous.get("owned_dll_hashes", [])) if previous else set()
    owned_config = set(previous.get("owned_config_hashes", [])) if previous else set()
    for file, desired, owned in [(destination, dll, owned_dll), (config_file, config, owned_config)]:
        actual = file_hash(file)
        if actual is not None and actual != digest(desired) and actual not in owned:
            raise ValueError(f"同名文件不属于已记录的安装版本，已保留：{file.name}")
    base_hash = digest(original)
    backup = Path("backups") / (base_hash + ".bin")
    backup_file = directory / backup
    if backup_file.exists() and file_hash(backup_file) != base_hash:
        raise ValueError("已有原程序备份损坏，已保留现有安装")
    if not backup_file.exists():
        atomic_write(backup_file, original)
    state = {"format": 1, "phase": "prepared", "target": target.name, "backup": backup.as_posix(),
             "base_sha256": base_hash, "patched_sha256": digest(patched), "dll_sha256": digest(dll),
             "config_sha256": digest(config), "owned_dll_hashes": sorted(owned_dll | {digest(dll)}),
             "owned_config_hashes": sorted(owned_config | {digest(config)})}
    save = lambda: atomic_write(state_file, (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    save()
    # 每个文件单独发布；EXE 最后写入，入口出现时 DLL 和配置已经就绪。
    for file, data in [(config_file, config), (destination, dll), (target, patched)]:
        if file_hash(file) != digest(data):
            atomic_write(file, data)
    state["phase"] = "installed"
    save()
    return state


def uninstall(target):
    target, directory, state_file = paths(target)
    state = state_for(target)
    if not state or state["phase"] == "uninstalled":
        return {"phase": "uninstalled"}
    current = target.read_bytes()
    if digest(current) == state["patched_sha256"]:
        original = (directory / state["backup"]).read_bytes()
        if digest(original) != state["base_sha256"]:
            raise ValueError("原程序备份损坏，尚未改动客户端")
        atomic_write(target, original)
    elif has_loader(current):
        return {"phase": "modified", "message": "程序已由其他工具修改，保留 EXE 与 DLL；请先还原后续补丁"}
    kept = []
    for name, hashes in [(DLL_NAME, state["owned_dll_hashes"]), (CONFIG_NAME, state["owned_config_hashes"])]:
        file = target.with_name(name)
        if not file.exists():
            continue
        if file_hash(file) in hashes:
            file.unlink()
        else:
            kept.append(name)
    state["phase"] = "uninstalled"
    atomic_write(state_file, (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return {"phase": "uninstalled", "kept": kept}


def status(target):
    target, _directory, _file = paths(target)
    state = state_for(target)
    actual = file_hash(target)
    return {"target": str(target), "phase": state["phase"] if state else "absent", "client_sha256": actual,
            "client_matches": bool(state and actual == state["patched_sha256"]),
            "dll_matches": bool(state and file_hash(target.with_name(DLL_NAME)) == state["dll_sha256"]),
            "config_matches": bool(state and file_hash(target.with_name(CONFIG_NAME)) == state["config_sha256"])}


def ensure_stopped(target):
    quoted = str(Path(target).resolve()).replace("'", "''")
    script = f"$p=Get-CimInstance Win32_Process | Where-Object {{$_.ExecutablePath -eq '{quoted}'}};if($p){{exit 1}}"
    ps7 = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/PowerShell/7/pwsh.exe"
    result = subprocess.run([str(ps7) if ps7.exists() else "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            creationflags=subprocess.CREATE_NO_WINDOW, capture_output=True)
    if result.returncode:
        raise ValueError("请先正常退出目标客户端，再安装或卸载 DLL")


def clean():
    root = ROOT.resolve()
    for name in ["build", "__pycache__", "tests/__pycache__"]:
        file = (root / name).resolve()
        if file == root or not file.is_relative_to(root):
            raise ValueError("清理路径不属于本项目")
        if file.exists():
            shutil.rmtree(file)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="安装或恢复独立 RisuAI 运行层 DLL")
    parser.add_argument("action", choices=["install", "status", "uninstall", "clean"])
    parser.add_argument("--target", type=Path)
    parser.add_argument("--dll", type=Path, default=ROOT / "dist" / DLL_NAME)
    parser.add_argument("--program")
    parser.add_argument("--arguments", default="")
    args = parser.parse_args()
    if args.action == "clean":
        clean()
        return
    if not args.target:
        parser.error("需要 --target 指定目标 EXE")
    if args.action in ["install", "uninstall"]:
        ensure_stopped(args.target)
    if args.action == "install":
        if not args.program:
            parser.error("install 需要 --program 指定后台助手")
        install(args.target, args.dll, args.program, args.arguments)
        result = status(args.target)
    elif args.action == "uninstall":
        result = uninstall(args.target)
    else:
        result = status(args.target)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
