#!/usr/bin/env python3
"""把 assets/pdfpages 下的逐页 JPEG 转成 WebP（q80），省约一半体积，首开提速。
同名 .webp 与 .jpg 并存；构建端按需引用 .webp。可重入（已转且较新则跳过）。"""
import os, sys
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(BASE, "assets", "pdfpages")
Q = 80


def one(jpg):
    webp = jpg[:-4] + ".webp"
    try:
        if os.path.exists(webp) and os.path.getmtime(webp) >= os.path.getmtime(jpg):
            return "skip"
        Image.open(jpg).convert("RGB").save(webp, "WEBP", quality=Q, method=4)
        return "ok"
    except Exception as e:
        return "fail:" + str(e)


def main():
    files = []
    for root, _, names in os.walk(PAGES):
        for n in names:
            if n.lower().endswith(".jpg"):
                files.append(os.path.join(root, n))
    print("jpg to transcode:", len(files), flush=True)
    ok = skip = fail = 0
    with ProcessPoolExecutor(max_workers=8) as ex:
        for i, r in enumerate(ex.map(one, files, chunksize=16)):
            if r == "ok": ok += 1
            elif r == "skip": skip += 1
            else: fail += 1; print("FAIL", files[i], r, flush=True)
            if (i + 1) % 400 == 0:
                print("done", i + 1, "/", len(files), flush=True)
    print("finished: ok=%d skip=%d fail=%d" % (ok, skip, fail), flush=True)


if __name__ == "__main__":
    main()
