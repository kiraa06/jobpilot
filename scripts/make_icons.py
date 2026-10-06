"""Write extension/icons/icon{16,48,128}.png using only the stdlib."""
import struct
import sys
import zlib
from pathlib import Path

BG = (79, 70, 229)      # indigo-600
FG = (255, 255, 255)


def pixel(x, y, n):
    cx = cy = (n - 1) / 2
    r = n * 0.22  # corner radius
    # rounded-square mask
    dx = max(abs(x - cx) - (n / 2 - r), 0)
    dy = max(abs(y - cy) - (n / 2 - r), 0)
    if dx * dx + dy * dy > r * r:
        return (0, 0, 0, 0)
    # four-point sparkle: |x|^0.5 + |y|^0.5 <= k
    ux, uy = abs(x - cx) / (n * 0.34), abs(y - cy) / (n * 0.34)
    if ux ** 0.5 + uy ** 0.5 <= 1:
        return FG + (255,)
    return BG + (255,)


def png(n):
    rows = b"".join(
        b"\x00" + b"".join(bytes(pixel(x, y, n)) for x in range(n)) for y in range(n)
    )

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


out = Path(sys.argv[1] if len(sys.argv) > 1 else "extension/icons")
out.mkdir(parents=True, exist_ok=True)
for size in (16, 48, 128):
    (out / f"icon{size}.png").write_bytes(png(size))
    print(f"wrote {out / f'icon{size}.png'}")
