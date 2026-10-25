use core::ffi::c_void;
#[link(name = "kernel32", kind = "raw-dylib")]
extern "system" {
    fn RtlMoveMemory(target: *mut u8, source: *const u8, size: usize);
    fn RtlFillMemory(target: *mut u8, size: usize, value: u8);
}
// 使用系统内存例程，发行 DLL 无需额外的 C 运行库。
#[no_mangle]
pub unsafe extern "C" fn memcpy(
    target: *mut c_void,
    source: *const c_void,
    size: usize,
) -> *mut c_void {
    RtlMoveMemory(target.cast(), source.cast(), size);
    target
}
#[no_mangle]
pub unsafe extern "C" fn memset(target: *mut c_void, value: i32, size: usize) -> *mut c_void {
    RtlFillMemory(target.cast(), size, value as u8);
    target
}
#[no_mangle]
pub unsafe extern "C" fn memcmp(a: *const c_void, b: *const c_void, size: usize) -> i32 {
    let a = a.cast::<u8>();
    let b = b.cast::<u8>();
    for i in 0..size {
        let x = a.add(i).read_volatile();
        let y = b.add(i).read_volatile();
        if x != y {
            return x as i32 - y as i32;
        }
    }
    0
}
