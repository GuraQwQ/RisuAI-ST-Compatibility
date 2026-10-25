"""为 x64 EXE 增加运行层加载入口，保留已有导入和程序代码。"""

import ctypes
import struct

DLL_NAME = "RisuRuntimeLoader.dll"
IMPORT_NAME = b"RisuRuntimeLoader_Init\0"
SECTION_NAME = b".risurt"


def align(value, boundary):
    if not boundary or boundary & (boundary - 1):
        raise ValueError("PE 对齐值异常")
    return (value + boundary - 1) & ~(boundary - 1)


class PE:
    def __init__(self, data):
        self.data = data
        if len(data) < 64 or data[:2] != b"MZ":
            raise ValueError("文件不是 Windows EXE/DLL")
        self.header = self.u32(0x3C)
        if data[self.header : self.header + 4] != b"PE\0\0":
            raise ValueError("PE 签名无效")
        self.optional = self.header + 24
        if self.u16(self.header + 4) != 0x8664 or self.u16(self.optional) != 0x20B:
            raise ValueError("当前补丁适用于 x64 PE32+ 程序")
        self.count = self.u16(self.header + 6)
        self.table = self.optional + self.u16(self.header + 20)
        self.sections = []
        for index in range(self.count):
            offset = self.table + index * 40
            self.sections.append(
                {
                    "name": data[offset : offset + 8].rstrip(b"\0"),
                    "size": self.u32(offset + 8),
                    "rva": self.u32(offset + 12),
                    "raw_size": self.u32(offset + 16),
                    "raw": self.u32(offset + 20),
                }
            )

    def u16(self, offset):
        return struct.unpack_from("<H", self.data, offset)[0]

    def u32(self, offset):
        return struct.unpack_from("<I", self.data, offset)[0]

    def directory(self, index):
        return struct.unpack_from("<II", self.data, self.optional + 112 + index * 8)

    def offset(self, rva):
        for section in self.sections:
            if section["rva"] <= rva < section["rva"] + section["raw_size"]:
                result = section["raw"] + rva - section["rva"]
                if result < len(self.data):
                    return result
        raise ValueError(f"RVA 没有对应文件内容：{rva:#x}")

    def string(self, rva):
        start = self.offset(rva)
        return self.data[start : self.data.index(b"\0", start)].decode("ascii")

    def imports(self):
        rva, size = self.directory(1)
        result = []
        if not rva:
            return result
        start = self.offset(rva)
        for offset in range(start, start + size, 20):
            entry = self.data[offset : offset + 20]
            if len(entry) != 20:
                break
            fields = struct.unpack("<5I", entry)
            if not any(fields):
                return result
            result.append((self.string(fields[3]), bytes(entry)))
        raise ValueError("导入表缺少结束项")


def checksum(data):
    image = ctypes.create_string_buffer(bytes(data))
    original = ctypes.c_uint32()
    computed = ctypes.c_uint32()
    function = ctypes.WinDLL("imagehlp").CheckSumMappedFile
    function.argtypes = [ctypes.c_void_p, ctypes.c_uint32,
                         ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32)]
    function.restype = ctypes.c_void_p
    if not function(image, len(data), ctypes.byref(original), ctypes.byref(computed)):
        raise ValueError("Windows 无法计算 PE 校验和")
    return computed.value


def add_import(original):
    pe = PE(original)
    imports = pe.imports()
    if any(name.lower() == DLL_NAME.lower() for name, _ in imports):
        return original
    if any(section["name"] == SECTION_NAME for section in pe.sections):
        raise ValueError("已有同名补丁节但未导入 DLL，请先核对文件")
    if pe.directory(4) != (0, 0):
        raise ValueError("主程序带数字签名，修改会使签名失效，请先核对版本")
    table_end = pe.table + pe.count * 40
    first_raw = min(section["raw"] for section in pe.sections if section["raw"])
    if pe.count >= 96 or table_end + 40 > first_raw:
        raise ValueError("此 EXE 的节表没有添加 DLL 导入所需的空间")
    file_alignment = pe.u32(pe.optional + 36)
    section_alignment = pe.u32(pe.optional + 32)
    raw = align(len(original), file_alignment)
    rva = align(max(s["rva"] + max(s["size"], s["raw_size"]) for s in pe.sections),
                section_alignment)
    directory_size = (len(imports) + 2) * 20
    payload = bytearray(directory_size)
    for index, (_, entry) in enumerate(imports):
        payload[index * 20 : index * 20 + 20] = entry
    dll_offset = len(payload)
    payload.extend(DLL_NAME.encode("ascii") + b"\0")
    payload.extend(bytes(align(len(payload), 2) - len(payload)))
    hint_offset = len(payload)
    payload.extend(b"\0\0" + IMPORT_NAME)
    payload.extend(bytes(align(len(payload), 8) - len(payload)))
    names_offset = len(payload)
    payload.extend(struct.pack("<QQ", rva + hint_offset, 0))
    addresses_offset = len(payload)
    payload.extend(struct.pack("<QQ", rva + hint_offset, 0))
    struct.pack_into("<5I", payload, len(imports) * 20,
                     rva + names_offset, 0, 0, rva + dll_offset, rva + addresses_offset)
    raw_size = align(len(payload), file_alignment)
    data = bytearray(original)
    data.extend(bytes(raw - len(data)))
    data.extend(payload)
    data.extend(bytes(raw_size - len(payload)))
    struct.pack_into("<8s6I2HI", data, table_end, SECTION_NAME, len(payload), rva,
                     raw_size, raw, 0, 0, 0, 0, 0xC0000040)
    struct.pack_into("<H", data, pe.header + 6, pe.count + 1)
    struct.pack_into("<I", data, pe.optional + 8, pe.u32(pe.optional + 8) + raw_size)
    struct.pack_into("<I", data, pe.optional + 56,
                     align(rva + len(payload), section_alignment))
    struct.pack_into("<II", data, pe.optional + 112 + 8, rva, directory_size)
    struct.pack_into("<II", data, pe.optional + 112 + 11 * 8, 0, 0)
    struct.pack_into("<I", data, pe.optional + 64, 0)
    struct.pack_into("<I", data, pe.optional + 64, checksum(data))
    patched = bytes(data)
    parsed = PE(patched)
    if parsed.imports()[:-1] != imports or parsed.imports()[-1][0] != DLL_NAME:
        raise ValueError("补丁导入表复核失败")
    return patched
