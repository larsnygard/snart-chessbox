#!/usr/bin/env python3
"""Generate the PWA icon PNGs from the committed SVG sources.

usage: python3 tools/make-icons.py
Requires rsvg-convert (librsvg) — deterministic output, no external services.

Two artworks are kept apart on purpose:
  icons/icon.svg           rounded square, transparent corners   -> purpose "any"
  icons/icon-maskable.svg  full-bleed square, art in the middle  -> purpose "maskable"
The apple-touch-icon must be opaque, so it is rendered from the maskable source.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"

JOBS = [
    ("icon.svg", "icon-192.png", 192),
    ("icon.svg", "icon-512.png", 512),
    ("icon-maskable.svg", "icon-maskable-512.png", 512),
    ("icon-maskable.svg", "apple-touch-icon-180.png", 180),
    ("icon.svg", "favicon-32.png", 32),
]


def main() -> int:
    for src, out, size in JOBS:
        cmd = ["rsvg-convert", "-w", str(size), "-h", str(size), str(ICONS / src), "-o", str(ICONS / out)]
        print(" ".join(cmd))
        subprocess.run(cmd, check=True)
    # report the real PNG dimensions so a wrong `sizes` in the manifest is caught
    for _, out, size in JOBS:
        data = (ICONS / out).read_bytes()
        w = int.from_bytes(data[16:20], "big")
        h = int.from_bytes(data[20:24], "big")
        status = "ok" if (w, h) == (size, size) else "MISMATCH"
        print(f"{out}: {w}x{h} (expected {size}x{size}) {status}")
        if status != "ok":
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
