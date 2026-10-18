#!/usr/bin/env python3
"""Extract chess piece outlines from DejaVu Sans as SVG paths.

Why: the Unicode figurines are rendered by the *viewer's* font, which means the
pieces look different on every device (and a device without a chess font shows
boxes). Converting the DejaVu glyphs to paths gives the same professional
shapes everywhere, colour-able with currentColor.

DejaVu fonts are under the Bitstream Vera / DejaVu licence (free to use and
redistribute, including modified outlines). Source: /usr/share/fonts/TTF.

usage: python3 tools/make-pieces.py
output: js/ui/piece-paths.js  ({ colour: { type: { d, box:[x,y,w,h] } } })
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "js" / "ui" / "piece-paths.js"
FONT = "DejaVu Sans"
GLYPHS = {
    "w": {"k": "\u2654", "q": "\u2655", "r": "\u2656", "b": "\u2657", "n": "\u2658", "p": "\u2659"},
    "b": {"k": "\u265a", "q": "\u265b", "r": "\u265c", "b": "\u265d", "n": "\u265e", "p": "\u265f"},
}
SIZE = 100  # glyph coordinate box before normalisation



NUM = re.compile(r"-?\d*\.?\d+(?:e-?\d+)?")


def path_bbox(d: str):
    """Ink bounding box of an SVG path (control points included).

    Inkscape's --query-all reports the text object's em box, which is identical
    for every glyph; normalising with it leaves outlined pieces off-centre and
    undersized. Parsing the path is a few lines and gives the real ink extent.
    """
    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    xs, ys = [], []
    cx = cy = 0.0
    start_x = start_y = 0.0
    i = 0
    cmd = None

    def num():
        nonlocal i
        v = float(tokens[i]); i += 1
        return v

    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                cx, cy = start_x, start_y
                continue
        if cmd is None:
            break
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            x, y = num(), num()
            if rel: x, y = cx + x, cy + y
            cx, cy = x, y
            start_x, start_y = x, y
            xs.append(x); ys.append(y)
            cmd = "l" if rel else "L"
        elif c == "L":
            x, y = num(), num()
            if rel: x, y = cx + x, cy + y
            cx, cy = x, y
            xs.append(x); ys.append(y)
        elif c == "H":
            x = num()
            cx = cx + x if rel else x
            xs.append(cx)
        elif c == "V":
            y = num()
            cy = cy + y if rel else y
            ys.append(cy)
        elif c in ("C", "S"):
            pts = [(num(), num()) for _ in range(3 if c == "C" else 2)]
            if rel: pts = [(cx + a, cy + b) for a, b in pts]
            for a, b in pts:
                xs.append(a); ys.append(b)
            cx, cy = pts[-1]
        elif c in ("Q", "T"):
            pts = [(num(), num()) for _ in range(2 if c == "Q" else 1)]
            if rel: pts = [(cx + a, cy + b) for a, b in pts]
            for a, b in pts:
                xs.append(a); ys.append(b)
            cx, cy = pts[-1]
        elif c == "A":
            rx, ry = num(), num()
            num(); num(); num()
            x, y = num(), num()
            if rel: x, y = cx + x, cy + y
            xs.extend([x - abs(rx), x + abs(rx)])
            ys.extend([y - abs(ry), y + abs(ry)])
            cx, cy = x, y
        else:
            i += 1
    if not xs or not ys:
        return [0, 0, 1, 1]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return [round(x0, 3), round(y0, 3), round(x1 - x0, 3), round(y1 - y0, 3)]


def to_path(glyph: str) -> tuple[str, list[float]]:
    """Return (svg path data, [x, y, w, h]) for one character."""
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "in.svg"
        dst = Path(td) / "out.svg"
        src.write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">'
            f'<text id="g" x="{SIZE/2}" y="{SIZE*0.82}" font-family="{FONT}" font-size="{SIZE*0.8}" '
            f'text-anchor="middle" fill="#000">{glyph}</text></svg>',
            encoding="utf-8",
        )
        subprocess.run(["inkscape", str(src), "--export-text-to-path", "--export-plain-svg",
                        f"--export-filename={dst}"], check=True, capture_output=True)
        svg = dst.read_text(encoding="utf-8")
        d = None
        for m in re.finditer(r'<path[^>]*\sd="([^"]+)"', svg):
            d = m.group(1) if d is None else d + " " + m.group(1)
        if not d:
            raise RuntimeError(f"no path produced for {glyph!r}")
        return d, path_bbox(d)


def main() -> int:
    data = {}
    for colour, pieces in GLYPHS.items():
        data[colour] = {}
        for kind, glyph in pieces.items():
            d, box = to_path(glyph)
            data[colour][kind] = {"d": d, "box": box}
            print(f"{colour}{kind}: path {len(d)} bytes, box {box}")
    body = json.dumps(data, separators=(",", ":"))
    OUT.write_text(
        "// @generated by tools/make-pieces.py — DejaVu Sans chess figurines as SVG paths.\n"
        "// DejaVu fonts: Bitstream Vera / DejaVu licence (free to use and redistribute,\n"
        "// including modified outlines). Regenerate instead of hand-editing.\n"
        f"export const PIECE_PATHS = {body};\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
