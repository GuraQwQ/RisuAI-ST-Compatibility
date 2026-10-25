#![no_std]

use core::{ffi::c_void, panic::PanicInfo};
mod memory;

type Handle = *mut c_void;
const CAP: usize = 32768;

#[repr(C)]
struct StartupInfo {
    cb: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    chars_x: u32,
    chars_y: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved_size: u16,
    reserved_bytes: *mut u8,
    input: Handle,
    output: Handle,
    error: Handle,
}

#[repr(C)]
struct ProcessInfo {
    process: Handle,
    thread: Handle,
    pid: u32,
    tid: u32,
}

#[link(name = "kernel32", kind = "raw-dylib")]
extern "system" {
    fn GetProcessHeap() -> Handle;
    fn HeapAlloc(heap: Handle, flags: u32, size: usize) -> Handle;
    fn HeapFree(heap: Handle, flags: u32, memory: Handle) -> i32;
    fn GetEnvironmentVariableW(name: *const u16, buffer: *mut u16, size: u32) -> u32;
    fn SetEnvironmentVariableW(name: *const u16, value: *const u16) -> i32;
    fn GetModuleFileNameW(module: Handle, path: *mut u16, size: u32) -> u32;
    fn GetCurrentProcessId() -> u32;
    fn GetLastError() -> u32;
    fn DisableThreadLibraryCalls(module: Handle) -> i32;
    fn CreateThread(
        attributes: Handle,
        stack: usize,
        start: unsafe extern "system" fn(Handle) -> u32,
        argument: Handle,
        flags: u32,
        id: *mut u32,
    ) -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn CreateFileW(
        path: *const u16,
        access: u32,
        share: u32,
        attributes: Handle,
        disposition: u32,
        flags: u32,
        template: Handle,
    ) -> Handle;
    fn ReadFile(file: Handle, bytes: *mut u8, size: u32, read: *mut u32, overlapped: Handle)
        -> i32;
    fn WriteFile(
        file: Handle,
        bytes: *const u8,
        size: u32,
        written: *mut u32,
        overlapped: Handle,
    ) -> i32;
    fn MultiByteToWideChar(
        page: u32,
        flags: u32,
        bytes: *const u8,
        size: i32,
        wide: *mut u16,
        cap: i32,
    ) -> i32;
    fn CreateProcessW(
        application: *const u16,
        command: *mut u16,
        process_attributes: Handle,
        thread_attributes: Handle,
        inherit: i32,
        flags: u32,
        environment: Handle,
        directory: *const u16,
        startup: *mut StartupInfo,
        process: *mut ProcessInfo,
    ) -> i32;
}

struct Buffer(*mut u16);
impl Buffer {
    unsafe fn new() -> Option<Self> {
        let pointer = HeapAlloc(GetProcessHeap(), 8, CAP * 2).cast::<u16>();
        if pointer.is_null() {
            None
        } else {
            Some(Self(pointer))
        }
    }
}
impl core::ops::Deref for Buffer {
    type Target = [u16];
    fn deref(&self) -> &[u16] {
        unsafe { core::slice::from_raw_parts(self.0, CAP) }
    }
}
impl core::ops::DerefMut for Buffer {
    fn deref_mut(&mut self) -> &mut [u16] {
        unsafe { core::slice::from_raw_parts_mut(self.0, CAP) }
    }
}
impl Drop for Buffer {
    fn drop(&mut self) {
        unsafe {
            HeapFree(GetProcessHeap(), 0, self.0.cast());
        }
    }
}
const fn wide<const N: usize>(bytes: &[u8; N]) -> [u16; N] {
    let mut result = [0; N];
    let mut i = 0;
    while i < N {
        result[i] = bytes[i] as u16;
        i += 1;
    }
    result
}

fn append(target: &mut [u16], length: &mut usize, text: &[u16]) -> bool {
    if *length + text.len() >= target.len() {
        return false;
    }
    target[*length..*length + text.len()].copy_from_slice(text);
    *length += text.len();
    target[*length] = 0;
    true
}

fn contains(text: &[u16], pattern: &[u8]) -> bool {
    text.windows(pattern.len())
        .any(|part| part.iter().zip(pattern).all(|(a, b)| *a == *b as u16))
}

fn trim(mut text: &[u16]) -> &[u16] {
    let space = |c: &u16| matches!(*c, 9 | 10 | 13 | 32 | 0xfeff);
    while text.first().is_some_and(space) {
        text = &text[1..];
    }
    while text.last().is_some_and(space) {
        text = &text[..text.len() - 1];
    }
    text
}

fn decimal(mut value: u32, buffer: &mut [u8; 10]) -> &[u8] {
    let mut i = buffer.len();
    loop {
        i -= 1;
        buffer[i] = b'0' + (value % 10) as u8;
        value /= 10;
        if value == 0 {
            return &buffer[i..];
        }
    }
}

unsafe fn log(directory: &[u16], message: &str, error: u32) {
    let Some(mut path) = Buffer::new() else {
        return;
    };
    let mut size = 0;
    if !append(&mut path, &mut size, directory)
        || !append(&mut path, &mut size, &wide(b"RisuRuntimeLoader.log"))
    {
        return;
    }
    let file = CreateFileW(
        path.as_ptr(),
        4,
        7,
        core::ptr::null_mut(),
        4,
        0x80,
        core::ptr::null_mut(),
    );
    if file as isize == -1 {
        return;
    }
    let mut bytes = [0u8; 1024];
    let mut n = 0;
    let mut pid_buffer = [0; 10];
    let mut error_buffer = [0; 10];
    for part in [
        message.as_bytes(),
        b" PID=",
        decimal(GetCurrentProcessId(), &mut pid_buffer),
        b" code=",
        decimal(error, &mut error_buffer),
        b"\r\n",
    ] {
        if n + part.len() > bytes.len() {
            break;
        }
        bytes[n..n + part.len()].copy_from_slice(part);
        n += part.len();
    }
    let mut written = 0;
    WriteFile(
        file,
        bytes.as_ptr(),
        n as u32,
        &mut written,
        core::ptr::null_mut(),
    );
    CloseHandle(file);
}

unsafe extern "system" fn start(module: Handle) -> u32 {
    let Some(mut path) = Buffer::new() else {
        return 0;
    };
    let length = GetModuleFileNameW(module, path.as_mut_ptr(), CAP as u32) as usize;
    if length == 0 || length >= CAP {
        return 0;
    }
    let Some(end) = path[..length].iter().rposition(|c| *c == 92 || *c == 47) else {
        return 0;
    };
    let Some(mut directory) = Buffer::new() else {
        return 0;
    };
    directory[..end + 1].copy_from_slice(&path[..end + 1]);
    let directory_slice = &directory[..end + 1];
    let mut length = end + 1;
    if !append(&mut path, &mut length, &wide(b"RisuRuntimeLoader.ini")) {
        return 0;
    }
    let file = CreateFileW(
        path.as_ptr(),
        0x80000000,
        7,
        core::ptr::null_mut(),
        3,
        0x80,
        core::ptr::null_mut(),
    );
    if file as isize == -1 {
        log(directory_slice, "无法读取运行层配置", GetLastError());
        return 0;
    }
    let Some(mut bytes) = Buffer::new() else {
        return 0;
    };
    let mut read = 0;
    let ok = ReadFile(
        file,
        bytes.as_mut_ptr().cast(),
        16384,
        &mut read,
        core::ptr::null_mut(),
    );
    CloseHandle(file);
    if ok == 0 || read == 0 || read >= 16384 {
        log(
            directory_slice,
            "配置读取失败或超过大小限制",
            GetLastError(),
        );
        return 0;
    }
    let Some(mut config) = Buffer::new() else {
        return 0;
    };
    let count = MultiByteToWideChar(
        65001,
        8,
        bytes.as_ptr().cast(),
        read as i32,
        config.as_mut_ptr(),
        CAP as i32,
    );
    if count <= 0 {
        log(directory_slice, "配置不是有效 UTF-8", GetLastError());
        return 0;
    }
    let mut program = None;
    let mut arguments = None;
    for line in config[..count as usize].split(|c| *c == 10).map(trim) {
        if line.is_empty() || matches!(line[0], 35 | 59) {
            continue;
        }
        if line.starts_with(&wide(b"program=")) && program.is_none() {
            program = Some(trim(&line[8..]));
        } else if line.starts_with(&wide(b"arguments=")) && arguments.is_none() {
            arguments = Some(trim(&line[10..]));
        } else {
            log(directory_slice, "配置存在未知或重复字段", 0);
            return 0;
        }
    }
    let (Some(program), Some(arguments)) = (program, arguments) else {
        log(directory_slice, "配置缺少 program 或 arguments", 0);
        return 0;
    };
    if program.is_empty() || program.contains(&0) || program.contains(&34) || arguments.contains(&0)
    {
        log(directory_slice, "配置路径或参数无效", 0);
        return 0;
    }
    let Some(mut executable) = Buffer::new() else {
        return 0;
    };
    let mut n = 0;
    if program.get(1) != Some(&58)
        && !program.starts_with(&[92, 92])
        && !append(&mut executable, &mut n, directory_slice)
    {
        return 0;
    }
    if !append(&mut executable, &mut n, program) {
        log(directory_slice, "程序路径过长", 0);
        return 0;
    }
    let Some(mut command) = Buffer::new() else {
        return 0;
    };
    let mut size = 0;
    let mut digits = [0; 10];
    let mut pid = [0u16; 10];
    let pid_bytes = decimal(GetCurrentProcessId(), &mut digits);
    for (i, byte) in pid_bytes.iter().enumerate() {
        pid[i] = *byte as u16;
    }
    for part in [
        &[34][..],
        &executable[..n],
        &wide(b"\" "),
        arguments,
        &wide(b" --attach-pid "),
        &pid[..pid_bytes.len()],
    ] {
        if !append(&mut command, &mut size, part) {
            log(directory_slice, "启动参数过长", 0);
            return 0;
        }
    }
    let mut startup: StartupInfo = core::mem::zeroed();
    startup.cb = core::mem::size_of::<StartupInfo>() as u32;
    startup.flags = 1;
    let mut process: ProcessInfo = core::mem::zeroed();
    let result = CreateProcessW(
        executable.as_ptr(),
        command.as_mut_ptr(),
        core::ptr::null_mut(),
        core::ptr::null_mut(),
        0,
        0x08000000,
        core::ptr::null_mut(),
        directory.as_ptr(),
        &mut startup,
        &mut process,
    );
    if result == 0 {
        log(directory_slice, "启动运行层助手失败", GetLastError());
    } else {
        CloseHandle(process.thread);
        CloseHandle(process.process);
        log(directory_slice, "已启动运行层助手", 0);
    }
    0
}

#[no_mangle]
pub unsafe extern "system" fn DllMain(module: Handle, reason: u32, _reserved: Handle) -> i32 {
    if reason == 1 {
        let name = wide(b"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\0");
        let Some(mut flags) = Buffer::new() else {
            return 1;
        };
        let count = GetEnvironmentVariableW(name.as_ptr(), flags.as_mut_ptr(), CAP as u32) as usize;
        if count < CAP {
            let mut n = count;
            if !contains(&flags[..n], b"--remote-debugging-port") {
                append(&mut flags, &mut n, &wide(b" --remote-debugging-port=0"));
            }
            if !contains(&flags[..n], b"--remote-debugging-address") {
                append(
                    &mut flags,
                    &mut n,
                    &wide(b" --remote-debugging-address=127.0.0.1"),
                );
            }
            SetEnvironmentVariableW(name.as_ptr(), flags.as_ptr());
        }
        // 不在加载器锁内读取配置、启动进程或等待线程；线程入口在加载通知完成后运行。
        DisableThreadLibraryCalls(module);
        let thread = CreateThread(
            core::ptr::null_mut(),
            0,
            start,
            module,
            0,
            core::ptr::null_mut(),
        );
        if !thread.is_null() {
            CloseHandle(thread);
        }
    }
    1
}

#[no_mangle]
pub extern "system" fn RisuRuntimeLoader_Init() {}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
