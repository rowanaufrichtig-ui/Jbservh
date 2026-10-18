#!/usr/bin/env python3
"""Draws the Square One launcher icons and splash screens for the Android app.

A white square holding an italic "1" on ink-blue graph paper, with the red
exercise-book margin line from the website's masthead.

    pip install pillow
    python3 scripts/make-app-icons.py

Writes into android/app/src/main/res (re-run after `npx cap add android`)
and desktop/build/icon.png for the Mac app.
"""

import io
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
FONT_URL = "https://fonts.gstatic.com/s/stixtwotext/v18/YA9Er02F12Xkf5whdwKf11l0p7uWhf8lJUzXZT2omhXcURU.ttf"

INK = (37, 67, 184)          # --accent, light theme
GRID = (255, 255, 255, 34)
WHITE = (255, 255, 255, 255)
MARGIN = (255, 125, 144, 255)  # --margin, dark theme (reads on blue)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
SS = 4  # supersampling factor for smooth edges


def font(size):
    data = urllib.request.urlopen(FONT_URL).read()
    return ImageFont.truetype(io.BytesIO(data), size)


FONT_CACHE = {}


def get_font(size):
    if size not in FONT_CACHE:
        FONT_CACHE[size] = font(size)
    return FONT_CACHE[size]


def background(w, h):
    """Ink-blue graph paper, cells sized relative to the shorter side."""
    img = Image.new("RGBA", (w, h), INK + (255,))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cell = min(w, h) / 9
    line = max(1, round(min(w, h) / 220))
    x = (w / 2) % cell
    while x < w:
        d.rectangle([round(x), 0, round(x) + line - 1, h], fill=GRID)
        x += cell
    y = (h / 2) % cell
    while y < h:
        d.rectangle([0, round(y), w, round(y) + line - 1], fill=GRID)
        y += cell
    return Image.alpha_composite(img, layer)


def mark(size, scale=1.0, margin_line=True):
    """The square-and-one mark on a transparent canvas of size x size."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    side = 0.40 * s * scale
    left, top = (s - side) / 2, (s - side) / 2
    stroke = 0.034 * s * scale
    if margin_line:
        mx = left - 0.085 * s * scale
        d.rectangle([mx, (s - side * 1.6) / 2, mx + 0.016 * s * scale, (s + side * 1.6) / 2], fill=MARGIN)
    d.rectangle([left, top, left + side, top + side], outline=WHITE, width=round(stroke))
    f = get_font(round(side * 0.82))
    bbox = d.textbbox((0, 0), "1", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((s / 2 - tw / 2 - bbox[0], s / 2 - th / 2 - bbox[1]), "1", font=f, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def rounded(img, radius_ratio):
    w, h = img.size
    m = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=round(w * SS * radius_ratio), fill=255)
    out = img.copy()
    out.putalpha(m.resize((w, h), Image.LANCZOS))
    return out


def circle(img):
    w, h = img.size
    m = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(m).ellipse([0, 0, w * SS - 1, h * SS - 1], fill=255)
    out = img.copy()
    out.putalpha(m.resize((w, h), Image.LANCZOS))
    return out


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print("wrote", path.relative_to(ROOT))


def mac_icon():
    """1024px macOS app icon: the Big Sur rounded square (824px, radius 185)
    with a soft drop shadow, as Apple's icon template lays it out."""
    size, body, radius = 1024, 824, 185
    off = (size - body) // 2
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([off, off + 12, off + body, off + body + 12], radius=radius, fill=(0, 0, 0, 80))
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    face = Image.alpha_composite(background(body, body), mark(body, scale=1.1))
    icon.alpha_composite(rounded(face, radius / body), (off, off))
    save(icon, ROOT / "desktop" / "build" / "icon.png")


def main():
    mac_icon()
    for name, k in DENSITIES.items():
        mip = RES / f"mipmap-{name}"
        fg = round(108 * k)
        # Adaptive icon layers (Android 8+). The mark sits inside the 66dp safe zone.
        save(mark(fg, scale=0.78), mip / "ic_launcher_foreground.png")
        save(background(fg, fg), mip / "ic_launcher_background.png")
        # Legacy icons (Android 7).
        legacy = round(48 * k)
        full = Image.alpha_composite(background(legacy, legacy), mark(legacy, scale=1.15))
        save(rounded(full, 0.18), mip / "ic_launcher.png")
        save(circle(full), mip / "ic_launcher_round.png")

    # Splash for Android 7-11 (Android 12+ draws its own from the icon).
    sizes = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280), "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
    for name, (w, h) in sizes.items():
        for orient, (W, H) in (("port", (w, h)), ("land", (h, w))):
            img = background(W, H)
            m = mark(round(min(W, H) * 0.9), scale=0.9)
            img.alpha_composite(m, ((W - m.width) // 2, (H - m.height) // 2))
            save(img.convert("RGB"), RES / f"drawable-{orient}-{name}" / "splash.png")
    img = background(480, 320)
    m = mark(288, scale=0.9)
    img.alpha_composite(m, ((480 - 288) // 2, (320 - 288) // 2))
    save(img.convert("RGB"), RES / "drawable" / "splash.png")


if __name__ == "__main__":
    main()
