#!/usr/bin/env python3
"""Download all CDN images & math SVGs referenced by scraped docs into assets/img/,
and write _raw/imgmap.json (original URL -> local relative path). Resumable."""
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import unquote
from urllib.request import Request, urlopen

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "_raw")
IMG_DIR = os.path.join(BASE, "assets", "img")
os.makedirs(IMG_DIR, exist_ok=True)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/146.0.0.0 Safari/537.36")

CARD_RE = re.compile(r'<card\s+[^>]*?name="(image|math)"[^>]*?value="([^"]*)"[^>]*?/?>')


def collect_urls():
    urls = {}
    for fn in os.listdir(os.path.join(RAW, "docs")):
        if not fn.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(RAW, "docs", fn), encoding="utf-8"))
        except Exception:
            continue
        content = d.get("content") or ""
        for m in CARD_RE.finditer(content):
            try:
                v = unquote(m.group(2)[5:] if m.group(2).startswith("data:") else m.group(2))
                val = json.loads(v)
                src = val.get("src") or ""
                if src.startswith("http"):
                    urls[src] = True
            except Exception:
                continue
    return list(urls)


def local_name(url, ctype):
    h = hashlib.sha1(url.encode()).hexdigest()[:16]
    ext = ""
    m = re.search(r"\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#]|$)", url, re.I)
    if m:
        ext = m.group(1).lower()
        if ext == "jpeg":
            ext = "jpg"
    if not ext and ctype:
        ct = ctype.split(";")[0].strip().lower()
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
               "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp"}.get(ct, "")
    return h + ("." + ext if ext else ".png")


def fetch(url, timeout=25):
    req = Request(url, headers={"User-Agent": UA, "Referer": "https://www.yuque.com/"})
    with urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


def main():
    urls = collect_urls()
    print("unique asset urls:", len(urls))
    imgmap_path = os.path.join(RAW, "imgmap.json")
    imgmap = {}
    if os.path.exists(imgmap_path):
        imgmap = json.load(open(imgmap_path, encoding="utf-8"))
    fails = []

    def work(url):
        for attempt in range(3):
            try:
                data, ctype = fetch(url)
                if not data or len(data) < 64:
                    raise ValueError("tiny/empty body")
                name = local_name(url, ctype)
                path = os.path.join(IMG_DIR, name)
                if not os.path.exists(path):
                    with open(path, "wb") as f:
                        f.write(data)
                return url, "assets/img/" + name
            except Exception as e:
                if attempt == 2:
                    return url, None
                time.sleep(1.0 + attempt)

    done = 0
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(work, urls):
            done += 1
            if done % 100 == 0:
                print("downloaded", done, "/", len(urls), flush=True)
            if r[1]:
                imgmap[r[0]] = r[1]
            else:
                fails.append(r[0])

    with open(imgmap_path, "w", encoding="utf-8") as f:
        json.dump(imgmap, f, ensure_ascii=False)
    print("saved:", len(imgmap), "failed:", len(fails))
    for u in fails[:30]:
        print("FAIL", u)


if __name__ == "__main__":
    main()
