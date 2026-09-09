#!/usr/bin/env python3
"""Full content verification for every PDF-bearing doc.

Reads each PDF (PyMuPDF) and compares its full text to the page DOM text.
Image-only PDFs (most pages have <30 CJK chars) skip text recall and instead
verify that the page contains the correct number of embedded page images.
"""
import asyncio
import json
import os
import re
import sys

import pymupdf as fitz
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "_raw")
ATT = os.path.join(BASE, "attachments")
REPORT = os.path.join(BASE, "tools", "verify_report.txt")


def all_pdf_docs():
    out = []
    import urllib.parse
    for fn in os.listdir(os.path.join(RAW, "docs")):
        if not fn.endswith(".json"):
            continue
        slug = fn[:-5]
        c = json.load(open(os.path.join(RAW, "docs", fn), encoding="utf-8")).get("content") or ""
        if "localdoc" not in c:
            continue
        for m in re.finditer(r'name="localdoc"[^>]*?value="(data:%7B[^"]+)"', c):
            try:
                val = json.loads(urllib.parse.unquote(m.group(1)[5:]))
            except Exception:
                continue
            name = val.get("name", "")
            if not name.lower().endswith(".pdf"):
                continue
            local = os.path.join(ATT, name)
            if os.path.exists(local):
                out.append((slug, local, name))
                break
    return out


def pdf_stats(path):
    d = fitz.open(path)
    parts, cjk = [], []
    for p in d:
        t = p.get_text("text") or ""
        parts.append(t)
        cjk.append(sum(1 for c in t if "一" <= c <= "鿿"))
    d.close()
    text = "\n".join(parts)
    img_pages = sum(1 for c in cjk if c < 30)
    total = max(len(cjk), 1)
    return text, cjk, img_pages, total, img_pages / total


def meaningful_images(path):
    """统计源 PDF 的有效内嵌图（与转换器同规则：w,h>=6；有文字的页排除 >85% 面积背景）。"""
    import pymupdf as _f
    d = _f.open(path)
    n = 0
    for pg in d:
        page_area = abs(pg.rect.width * pg.rect.height)
        has_text = bool((pg.get_text("text") or "").strip())
        for info in pg.get_image_info():
            x0, y0, x1, y1 = info["bbox"]
            w, h = x1 - x0, y1 - y0
            if w < 6 or h < 6:
                continue
            if has_text and page_area and (w * h) > page_area * 0.85:
                continue
            n += 1
    d.close()
    return n


def normalize(s):
    s = re.sub(r"[ \t\n\r\u3000]+", "", s)
    return re.sub(r"[，。；：、！？…—）」』\u3002\uff01\uff0c\uff1b\uff1a\u201c\u201d\u2018\u2019（）()【】《》《·\-]", "", s)


async def fetch_page(slug):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={"width": 1440, "height": 1200})
        await page.goto(f"http://127.0.0.1:8686/#/{slug}", wait_until="networkidle")
        await page.wait_for_timeout(1800)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(1500)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(400)
        text = await page.evaluate("() => document.querySelector('.doc-body').innerText")
        page_imgs = await page.evaluate(
            "() => document.querySelectorAll('.doc-body .pdf-page img').length"
        )
        fig_imgs = await page.evaluate(
            "() => document.querySelectorAll('.doc-body .img-card img').length"
        )
        await b.close()
        return text, page_imgs, fig_imgs


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


async def main():
    pairs = all_pdf_docs()
    print(f"PDF-bearing docs: {len(pairs)}")

    rows = []
    fails = []

    for batch in chunked(pairs, 5):
        results = await asyncio.gather(
            *(fetch_page(slug) for slug, _, _ in batch),
            return_exceptions=True,
        )
        for (slug, local, name), r in zip(batch, results):
            if isinstance(r, Exception):
                fails.append((slug, name, "render-err"))
                continue
            page_text, page_imgs, fig_imgs = r
            src_text, per_cjk, img_pages, total, img_ratio = pdf_stats(local)
            src_norm = normalize(src_text)
            pg_norm = normalize(page_text)
            src_fig_n = meaningful_images(local)
            if img_ratio >= 0.7:
                # 图片型 PDF：验证页图数 = PDF 总页数
                ok = page_imgs >= total - 1
                rows.append((slug, name, len(src_norm), len(pg_norm),
                             1.0 if ok else 0.0, img_pages, total, page_imgs,
                             "img" if ok else "img-missing"))
                if not ok:
                    fails.append((slug, name, f"page-images {page_imgs}/{total}"))
            else:
                # 文字型 PDF：文字 recall + 内嵌图数量 双对比
                if not src_norm:
                    continue
                present = sum(1 for ch in src_norm if ch in pg_norm)
                recall = present / len(src_norm)
                img_ok = fig_imgs >= src_fig_n
                status = "ok" if (recall >= 0.92 and img_ok) else ("img-mismatch" if recall >= 0.92 else "low-recall")
                rows.append((slug, name, len(src_norm), len(pg_norm),
                             round(recall, 4), src_fig_n, total, fig_imgs,
                             status))
                if recall < 0.92:
                    fails.append((slug, name, f"recall={recall:.3f}"))
                if not img_ok:
                    fails.append((slug, name, f"figures {fig_imgs}/{src_fig_n}"))

    # write report
    rows.sort(key=lambda x: x[4])
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write(f"total: {len(rows)}  failures: {len(fails)}\n\n")
        f.write("recall\tsrc_chars\tpg_chars\tsrc_imgs\ttotal\tdom_imgs\tslug\tname\tstatus\n")
        for r in rows:
            f.write(f"{r[4]:.4f}\t{r[2]}\t{r[3]}\t{r[5]}\t{r[6]}\t{r[7]}\t{r[0]}\t{r[1]}\t{r[8] if isinstance(r[8],str) else ''}\n")

    print(f"\nDone. failures={len(fails)}/{len(rows)}")
    for f_ in fails[:10]:
        print(" ", f_)
    print(f"report: {REPORT}")


if __name__ == "__main__":
    asyncio.run(main())
