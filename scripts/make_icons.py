"""Draws the app icons (a spiral, hinting at endless zoom) into public/icons."""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
PAPER = (247, 246, 242, 255)
INK = (31, 31, 31, 255)


def spiral(size: int, inset: float) -> Image.Image:
    scale = 4  # draw big, then shrink for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), PAPER)
    d = ImageDraw.Draw(img)
    cx = cy = s / 2
    r_max = s * (0.5 - inset)
    # Logarithmic spiral: looks the same at every zoom level.
    turns = 3.2
    b = math.log(r_max / (s * 0.012)) / (turns * 2 * math.pi)
    pts = []
    steps = 900
    for i in range(steps + 1):
        t = i / steps * turns * 2 * math.pi
        r = r_max * math.exp(-b * (turns * 2 * math.pi - t))
        a = t - math.pi / 2
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    for i in range(1, len(pts)):
        w = max(1, int(s * 0.004 + s * 0.05 * (i / len(pts)) ** 1.5))
        d.line([pts[i - 1], pts[i]], fill=INK, width=w)
        d.ellipse([pts[i][0] - w / 2, pts[i][1] - w / 2, pts[i][0] + w / 2, pts[i][1] + w / 2], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    spiral(180, 0.16).convert("RGB").save(OUT / "apple-touch-icon.png")
    spiral(192, 0.14).save(OUT / "icon-192.png")
    spiral(512, 0.14).save(OUT / "icon-512.png")
    spiral(512, 0.24).save(OUT / "icon-maskable-512.png")


if __name__ == "__main__":
    main()
