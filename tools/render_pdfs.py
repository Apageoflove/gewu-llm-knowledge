#!/usr/bin/env python3
"""Render every local PDF attachment into per-page JPEGs under assets/pdfpages/<hash>/.
Faithful page images, ~1280px wide, lazy-loaded by the site. Resumable."""
import hashlib
import os
import sys

import fitz  # PyMuPDF

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATT = os.path.join(BASE, "attachments")
OUT = os.path.join(BASE, "assets", "pdfpages")
os.makedirs(OUT, exist_ok=True)

TARGET_W = 2200


def pdf_key(name):
    return hashlib.sha1(name.encode()).hexdigest()[:12]


def render(name):
    src = os.path.join(ATT, name)
    key = pdf_key(name)
    pdir = os.path.join(OUT, key)
    marker = os.path.join(pdir, "done.txt")
    if os.path.exists(marker):
        return "skip"
    os.makedirs(pdir, exist_ok=True)
    doc = fitz.open(src)
    zoom = TARGET_W / doc[0].rect.width if doc[0].rect.width else 2.0
    zoom = min(max(zoom, 1.0), 3.2)
    mat = fitz.Matrix(zoom, zoom)
    from PIL import Image, ImageChops
    import io
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat)
        out = os.path.join(pdir, "p-%03d.jpg" % (i + 1))
        if os.path.exists(out):
            continue
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        # 自动去白边（内容不变，仅裁空白边距，等效字号更大）
        bg = Image.new("RGB", img.size, (255, 255, 255))
        diff = ImageChops.difference(img, bg).convert("L")
        bbox = diff.point(lambda p: 255 if p > 14 else 0).getbbox()
        if bbox:
            pad = 14
            l = max(0, bbox[0] - pad); t = max(0, bbox[1] - pad)
            r = min(img.width, bbox[2] + pad); b = min(img.height, bbox[3] + pad)
            if (r - l) > img.width * 0.3 and (b - t) > img.height * 0.3:
                img = img.crop((l, t, r, b))
        img.save(out, "JPEG", quality=84)
    with open(marker, "w") as f:
        f.write(str(len(doc)))
    doc.close()
    return "ok"


def main():
    pdfs = sorted(f for f in os.listdir(ATT) if f.lower().endswith(".pdf"))
    print("pdfs:", len(pdfs), flush=True)
    done = 0
    for i, name in enumerate(pdfs):
        try:
            st = render(name)
        except Exception as e:
            print("FAIL", name, e, flush=True)
            st = "fail"
        done += 1
        if done % 20 == 0:
            print("rendered", done, "/", len(pdfs), flush=True)
    print("finished", flush=True)


if __name__ == "__main__":
    main()
