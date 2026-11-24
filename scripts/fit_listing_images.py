"""Turns dashboard screenshots into 1600 x 900 (16:9) images for the Shopify App Store listing.

For each image: the left sidebar (the admin menu a merchant would not see) is cut off, then the rest
is cropped to 16:9 from the top-left and resized to 1600 x 900. Nothing is added or invented.

Run with: venv/Scripts/python scripts/fit_listing_images.py <input folder or files...> [--left 280] [--out DIR]
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

TARGET = (1600, 900)


def fit(img: Image.Image, left: int) -> Image.Image:
    w, h = img.size
    img = img.convert("RGB").crop((min(left, w // 2), 0, w, h))
    w, h = img.size
    want_w = int(h * 16 / 9)
    if want_w <= w:  # wider than 16:9 -> keep the left part
        img = img.crop((0, 0, want_w, h))
    else:  # taller than 16:9 -> keep the top part
        img = img.crop((0, 0, w, int(w * 9 / 16)))
    return img.resize(TARGET, Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--left", type=int, default=280, help="pixels of sidebar to cut off the left (default 280; 0 keeps it)")
    parser.add_argument("--out", default="listing_images")
    args = parser.parse_args()

    files: list[Path] = []
    for item in args.inputs:
        p = Path(item)
        files += sorted(p.glob("*.png")) + sorted(p.glob("*.jpg")) if p.is_dir() else [p]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for f in files:
        result = fit(Image.open(f), args.left)
        dest = out / f"{f.stem}_1600x900.png"
        result.save(dest, "PNG")
        print(f"{f.name} -> {dest} {result.size}")
    if not files:
        sys.exit("no images found")


if __name__ == "__main__":
    main()
