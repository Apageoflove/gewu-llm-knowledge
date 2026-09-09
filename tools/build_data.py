#!/usr/bin/env python3
"""Build site data from scraped Yuque docs: lake HTML -> clean HTML, chunks, search index."""
import json
import hashlib
import os
import re
import sys
from urllib.parse import unquote
from collections import OrderedDict
import collections

from bs4 import BeautifulSoup, NavigableString, Tag

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "_raw")
DATA = os.path.join(BASE, "data")
os.makedirs(DATA, exist_ok=True)

BOOK_NS = "aaron-wecc3/dhluml"

# 推广/团队导读文档（空壳，内容为知识库公告，不收录）
DROP_SLUGS = {"foho2nsutnn37gw3"}

# 品牌词清理：只清除机构指向的表达，保护技术术语（图灵奖/图灵机/图灵测试/图灵完备）
BRAND_PATTERNS = [
    (re.compile(r"[（(]?图灵课堂[）)]?"), ""),
    (re.compile(r"[（(]?图灵学院[）)]?"), ""),
    (re.compile(r"[（(]?图灵教育[）)]?"), ""),
    (re.compile(r"图灵诸葛老师"), ""),
    (re.compile(r"图灵诸葛"), ""),
    (re.compile(r"图灵教研(团队)?"), ""),
    (re.compile(r"Python@图灵"), "Python"),
    (re.compile(r"@图灵"), ""),
]


def sanitize_brand(s):
    if "图灵" not in s:
        return s
    for pat, rep in BRAND_PATTERNS:
        s = pat.sub(rep, s)
    # 清理残留的空括号与重复标点
    s = re.sub(r"[（(]\s*[）)]", "", s)
    s = re.sub(r"([，。；、：])\1+", r"\1", s)
    return s

KEEP_COLOR = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]+)$")


def parse_card_value(v):
    if not v:
        return {}
    if v.startswith("data:"):
        v = v[5:]
    try:
        v = unquote(v)
        return json.loads(v)
    except Exception:
        try:
            return json.loads(v)
        except Exception:
            return {}


def human_size(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return ("%d%s" % (n, unit)) if unit == "B" else ("%.1f%s" % (n, unit))
        n /= 1024.0


def convert(content, imgmap=None, attmap=None):
    """lake HTML -> (clean_html, outline, plaintext)"""
    imgmap = imgmap or {}
    attmap = attmap or {}
    soup = BeautifulSoup(content or "", "lxml")
    outline = []

    # --- cards ---
    for card in soup.find_all("card"):
        name = card.get("name", "")
        val = parse_card_value(card.get("value", ""))
        repl = None
        if name == "image":
            src = val.get("src", "")
            if src:
                fig = soup.new_tag("figure")
                fig["class"] = "img-card"
                fig["data-ratio"] = str(round(val.get("ratio", 0) or 0, 3))
                img = soup.new_tag("img")
                img["src"] = imgmap.get(src, src)
                img["alt"] = val.get("name") or val.get("caption") or "图片"
                img["loading"] = "lazy"
                if val.get("originWidth"):
                    img["width"] = int(val["originWidth"])
                if val.get("originHeight"):
                    img["height"] = int(val["originHeight"])
                fig.append(img)
                cap = val.get("caption") or ""
                if cap and cap.strip():
                    fc = soup.new_tag("figcaption")
                    fc.string = cap.strip()
                    fig.append(fc)
                repl = fig
        elif name == "codeblock":
            code = val.get("code", "")
            lang = val.get("mode", "") or "text"
            pre = soup.new_tag("pre")
            pre["class"] = "code-block"
            pre["data-lang"] = lang
            c = soup.new_tag("code")
            c.string = code
            pre.append(c)
            repl = pre
        elif name == "math":
            src = val.get("src", "")
            latex = val.get("code", "")
            if src:
                img = soup.new_tag("img")
                img["class"] = "math-img"
                img["src"] = imgmap.get(src, src)
                img["alt"] = latex
                img["loading"] = "lazy"
                repl = img
            else:
                c = soup.new_tag("code")
                c["class"] = "math-fallback"
                c.string = latex
                repl = c
        elif name == "hr":
            repl = soup.new_tag("hr")
        elif name == "localdoc":
            src = val.get("src", "")
            local = attmap.get(src)
            a = soup.new_tag("a")
            a["class"] = "attachment"
            a["href"] = local or src
            a["target"] = "_blank"
            if not local:
                a["rel"] = "noopener"
            nm = val.get("name") or "附件"
            ext = (val.get("ext") or "").upper()
            size = human_size(val.get("size"))
            meta = " · ".join(x for x in (ext, size) if x)
            a["data-meta"] = meta
            a.string = nm
            repl = a
        else:
            d = soup.new_tag("div")
            d["class"] = "unknown-card"
            d["data-card"] = name
            d.string = "[卡片: %s]" % name
            repl = d
        if repl is None:
            card.decompose()
        else:
            card.replace_with(repl)

    # --- unwrap p that only contains one block-level child ---
    for p in soup.find_all("p"):
        kids = [c for c in p.children if isinstance(c, Tag) or (isinstance(c, NavigableString) and str(c).strip())]
        if len(kids) == 1 and isinstance(kids[0], Tag) and kids[0].name in ("figure", "pre", "hr"):
            p.replace_with(kids[0])

    # --- headings: ids + outline ---
    hnum = 0
    for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        hnum += 1
        hid = "h%d" % hnum
        h["id"] = hid
        outline.append({"id": hid, "text": h.get_text(strip=True), "level": int(h.name[1])})

    # --- links ---
    for a in soup.find_all("a"):
        href = a.get("href", "") or ""
        m = re.match(r"^/" + re.escape(BOOK_NS) + r"/([a-z0-9]+)(?:#(.*))?$", href)
        if m:
            slug = m.group(1)
            frag = m.group(2) or ""
            a["href"] = "#/" + slug + (("#" + frag) if frag else "")
            a["class"] = "doc-link"
            a.attrs.pop("target", None)
            a.attrs.pop("rel", None)
        elif href.startswith("#"):
            pass
        elif href.startswith("http"):
            a["target"] = "_blank"
            a["rel"] = "noopener"
            if "class" not in a.attrs or not a.get("class"):
                a["class"] = "ext-link"
        elif href.startswith("attachments/") or href.startswith("assets/"):
            a["target"] = "_blank"
        elif not href:
            a.unwrap()

    # --- strip attributes ---
    ALLOWED = {
        "a": {"href", "target", "rel", "class", "data-meta"},
        "img": {"src", "alt", "width", "height", "loading", "class"},
        "td": {"colspan", "rowspan"},
        "th": {"colspan", "rowspan", "class"},
        "ol": {"start"},
        "pre": {"class", "data-lang"},
        "code": {"class"},
        "figure": {"class", "data-ratio"},
        "figcaption": set(),
        "span": {"style"},
    }
    for tag in soup.find_all(True):
        allowed = ALLOWED.get(tag.name)
        if allowed is None:
            if tag.name not in ("p", "strong", "em", "u", "s", "br", "hr", "ul", "ol", "li",
                                "table", "thead", "tbody", "tr", "blockquote",
                                "h1", "h2", "h3", "h4", "h5", "h6"):
                tag.unwrap()
                continue
            tag.attrs = {}
        else:
            tag.attrs = {k: v for k, v in tag.attrs.items() if k in allowed}
        if tag.name == "span":
            style = tag.get("style", "")
            m = re.search(r"(?:^|;)\s*color\s*:\s*([^;]+)", style)
            if m and KEEP_COLOR.match(m.group(1).strip()):
                tag.attrs = {"style": "color:%s" % m.group(1).strip()}
            else:
                tag.unwrap()

    # remove empty wrappers
    for tag in soup.find_all(["table"]):
        for junk in tag.find_all(["meta", "colgroup", "col"]):
            junk.decompose()

    # drop top-level empty p
    for p in soup.find_all("p"):
        if not p.get_text(strip=True) and not p.find(["img", "figure", "br"]):
            p.decompose()

    html = soup.decode() if hasattr(soup, "decode") else str(soup)
    # body-level cleanup: soup is a full document; take inner of body
    body = soup.body if soup.body is not None else soup
    html = body.decode_contents() if hasattr(body, "decode_contents") else str(body)
    html = re.sub(r"^\s*<!DOCTYPE[^>]*>\s*", "", html)
    html = sanitize_brand(html)
    plaintext = re.sub(r"\s+", " ", body.get_text(" ", strip=True))
    plaintext = sanitize_brand(plaintext)
    return html, outline, plaintext


CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def build_tree():
    """语雀目录真实结构 = parent_uuid 树 + child_uuid/sibling_uuid 链表（官方展示顺序）。
    数组顺序不可信（专题一在数组中是 154→1 倒序）。
    展示顺序规则：无数字编号的置顶项保持链表顺序在前；带编号的文档按编号升序（从 1 开始）。"""
    toc = json.load(open(os.path.join(RAW, "toc.json"), encoding="utf-8"))
    by_uuid = {t.get("uuid"): t for t in toc if t.get("uuid")}

    def ordered_kids(node):
        kids = [t for t in toc if t.get("parent_uuid") == node.get("uuid")]
        if not kids:
            return []
        kid_ids = {k["uuid"] for k in kids}
        order, seen = [], set()
        cur = node.get("child_uuid")
        while cur and cur in kid_ids and cur not in seen:
            order.append(by_uuid[cur])
            seen.add(cur)
            cur = by_uuid[cur].get("sibling_uuid")
        for k in kids:  # 链条断裂的孤儿按数组顺序补齐
            if k["uuid"] not in seen:
                order.append(k)
        return order

    def num_of(t):
        m = re.match(r"\s*(\d+)", t.get("title", ""))
        return int(m.group(1)) if m else None

    def sort_display(kids):
        pinned = [k for k in kids if num_of(k) is None]
        numbered = sorted((k for k in kids if num_of(k) is not None), key=num_of)
        return pinned + numbered

    def sec_rank(title):
        m = re.match(r"专题([一二三四五六七八九十])", title)
        return CN_NUM[m.group(1)] if m else 50

    def has_body(entry):
        slug = (entry.get("url") or "").split("/")[-1]
        p = os.path.join(RAW, "docs", slug + ".json")
        if not p.endswith(".json") or not os.path.exists(p):
            return False
        c = json.load(open(p, encoding="utf-8")).get("content", "") or ""
        text = re.sub(r"<[^>]+>", "", c).strip()
        return bool(text) or "<card" in c

    def build_items(node):
        items = []
        for k in sort_display(ordered_kids(node)):
            sub = ordered_kids(k)
            if k.get("url"):  # DOC；自身带子文档则收成分组（容器页有正文时收录为首篇）
                if sub:
                    grp_items = ([k["url"]] if has_body(k) and k["url"] not in DROP_SLUGS else []) + build_items(k)
                    items.append({"title": sanitize_brand(k["title"]), "items": grp_items})
                elif k["url"] not in DROP_SLUGS:
                    items.append(k["url"])
            else:  # GROUP
                items.append({"title": sanitize_brand(k["title"]), "items": build_items(k)})
        return items

    sections = []
    roots = [t for t in toc if t.get("level") == 0]
    for root in roots:
        kids = sort_display(ordered_kids(root))
        # 「专题N」命名的顶级子项视作分组头（本库约定：专题七/九是带正文的容器 DOC 也算分组）
        def is_sec_header(k):
            return (not k.get("url")) or bool(ordered_kids(k)) or re.match(r"专题[一二三四五六七八九十]", k.get("title", ""))
        loose = [k for k in kids if k.get("url") and not is_sec_header(k) and k["url"] not in DROP_SLUGS]
        if loose:
            # 根下有散文档：分组嵌套进以根命名的 section（如 AI大模型 > MCP组 + 280篇）
            sections.append({"title": sanitize_brand(root.get("title", "导读")), "items": build_items(root)})
        else:
            # 根下全是分组：每个分组（或带子文档的容器 DOC）独立成 section，按「专题N」序号排前
            root_secs = []
            for k in kids:
                if not is_sec_header(k):
                    continue
                items = ([k["url"]] if k.get("url") and has_body(k) and k["url"] not in DROP_SLUGS else []) + build_items(k)
                root_secs.append({"title": sanitize_brand(k["title"]), "items": items})
            root_secs.sort(key=lambda s: sec_rank(s["title"]))
            sections.extend(root_secs)

    def collapse(items):
        out = []
        for it in items:
            if isinstance(it, dict):
                sub = collapse(it["items"])
                if len(sub) == 1 and isinstance(sub[0], str):
                    out.append(sub[0])
                else:
                    it["items"] = sub
                    out.append(it)
            else:
                out.append(it)
        return out

    out = []
    for s in sections:
        s["items"] = collapse(s["items"])
        out.append(s)
    return out


def pdf_search_text(path, limit=60000):
    """提取 PDF 文本用于全文搜索（尽力而为，图片型 PDF 返回空）"""
    try:
        from pypdf import PdfReader
        r = PdfReader(path)
        parts = []
        for pg in r.pages[:80]:
            t = pg.extract_text() or ""
            parts.append(t)
        txt = "\n".join(parts)
        txt = re.sub(r"[ \t]+", " ", txt)
        txt = re.sub(r"\n{2,}", "\n", txt)
        return txt[:limit]
    except Exception:
        return ""


HEADING_RE = re.compile(r"^([一二三四五六七八九十百]+[、.]|\d{1,2}[、.．)]|[①②③④⑤⑥⑦⑧⑨⑩]|Q\d+[.、:：]?|第[一二三四五六七八九十\d]+[章节部分]|CONTENTS|目\s*录|（[^）]{1,40}）|\(.{1,40}\))$")
CJK_TAIL = re.compile(r"[，。；：、！？…—）》」』\u4e00-\u9fff]$")
PAGE_NO = re.compile(r"^\d{1,3}$")
NUMBER_LIST = re.compile(r"^([一二三四五六七八九十]+[、.]|\d{1,2}[.．、)])\s*")


def _lines_to_html(text):
    """PDF 页文本 -> 网页原生 HTML（智能标题识别 + 段落流式）"""
    out = []
    buf = ""

    def flush():
        nonlocal buf
        if buf.strip():
            out.append("<p>%s</p>" % esc_html(buf.strip()))
        buf = ""

    def is_heading(l):
        if PAGE_NO.match(l):
            return False
        if len(l) > 50:
            return False
        if HEADING_RE.match(l):
            return True
        # 短行 + 不含句末标点 + 全角小语种字符 -> 标题候选
        if len(l) <= 22 and not re.search(r"[，。；：、！？…—）」』]$", l) and any("一" <= c <= "鿿" for c in l):
            return True
        return False

    def is_numbered(l):
        m = NUMBER_LIST.match(l)
        return m and len(l) < 80

    for raw in text.split("\n"):
        l = raw.strip()
        if not l:
            flush()
            continue
        if is_heading(l):
            flush()
            out.append("<h3>" + esc_html(l) + "</h3>")
            continue
        if is_numbered(l):
            flush()
            out.append("<h4>" + esc_html(l) + "</h4>")
            continue
        if buf:
            tail_cjk = bool(re.search(r"[\u4e00-\u9fff，。；：、！？…—）」』]$", buf))
            head_cjk = bool(re.match(r"[\u4e00-\u9fff]", l[0]))
            buf += "" if (tail_cjk or head_cjk) else " "
        buf += l
        if len(buf) > 240:
            flush()
    flush()

    # 段落合并：相邻 <p> 若上一个极短且看起来像上一段的延续，则合并
    merged = []
    for el in out:
        if merged and el.startswith("<p>") and merged[-1].startswith("<p>"):
            pm = merged[-1]
            inner_prev = re.sub(r"</?p>", "", pm)
            if len(inner_prev) < 60:
                merged[-1] = pm[:-4] + " " + el[3:]
                continue
        merged.append(el)
    return "".join(merged)


def esc_html(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _pdfminer_html(href):
    """pdfminer.six -> 网页原生 HTML。

    设计：单一数据流，三阶段——
      1) 抽取：每行带元数据（y/x/字号/字体/文本，保留行内空格）
      2) 分类：标题（字号相对页内正文均值放大）/ 列表项（bullet 或编号开头）/
         代码（等宽字体、# 注释、纯 ASCII 高符号密度）/ 正文
      3) 分组输出：正文行按 (y 间距, x 缩进, 上行结尾标点) 合并成段；
         代码行逐行保留在 <pre> 中；只有 flush 函数向输出写入（杜绝重复）
    """
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextBox, LTTextLine, LTChar, LTAnno

    local = os.path.join(BASE, href)
    if not os.path.exists(local):
        return None, 0, 0

    key = hashlib.sha1(os.path.basename(href).encode()).hexdigest()[:12]
    pdir = os.path.join(BASE, "assets", "pdfpages", key)
    pages_img = sorted(f for f in os.listdir(pdir) if f.endswith(".jpg")) if os.path.isdir(pdir) else []

    try:
        with open(local, "rb") as fp:
            pages = list(extract_pages(fp))
    except Exception:
        return None, 0, 0

    BULLET_CH = "\u2022\u2023\u25E6\u2027\u25cf\u25cb\u00b7\u25aa\u25ab\u25fe\u25fc\u25fb\u25a0\u25a1\u2713\u2717\u25b6"
    RE_BULLET = re.compile(r"^[" + BULLET_CH + r"]\s*")
    RE_NUM_PREFIX = re.compile(r"^(\d{1,2}|[\u2460-\u2473]|[一二三四五六七八九十]{1,3})[\u3001.．)）]\s*")
    RE_STRONG_END = re.compile(r"[。；！？…」』）!]$")
    RE_CJK = re.compile(r"[\u4e00-\u9fff，。；：、！？…（「『]")
    RE_CODE_SYM = re.compile(r"[{}\[\]();=><|!+\-*/&%^~#?:]")

    def line_text(line):
        parts = []
        for ch in line:
            if isinstance(ch, (LTChar, LTAnno)):
                parts.append(ch.get_text())
        return "".join(parts).strip()

    def line_size(line):
        sizes = [c.size for c in line if isinstance(c, LTChar)]
        return sum(sizes) / len(sizes) if sizes else 0.0

    def line_mono(line):
        for c in line:
            if isinstance(c, LTChar):
                fn = (c.fontname or "").lower()
                if "mono" in fn or "courier" in fn or "consol" in fn:
                    return True
        return False

    def line_bold(line):
        for c in line:
            if isinstance(c, LTChar):
                fn = (c.fontname or "").lower()
                if "bold" in fn or "heavy" in fn or "black" in fn:
                    return True
        return False

    def join_text(a, b):
        """跨行合并：CJK 边界直接拼接，ASCII 边界补一个空格。"""
        if not a:
            return b
        if RE_CJK.search(a[-1]) or RE_CJK.match(b[0]):
            return a + b
        return a + " " + b

    # ---- 内嵌图片提取（公式/插图），磁盘缓存避免重复渲染 ----
    img_dir = os.path.join(BASE, "assets", "pdfimg", key)
    _fitz_doc = None

    def fitz_doc():
        nonlocal _fitz_doc
        if _fitz_doc is None:
            try:
                import pymupdf as _f
                _fitz_doc = _f.open(local)
            except Exception:
                _fitz_doc = False
        return _fitz_doc

    def page_images(pi):
        """返回第 pi 页的内嵌图片 [{top,x,w,h,src}]（PDF 坐标系，y-up）。"""
        doc = fitz_doc()
        if not doc or pi >= doc.page_count:
            return []
        page = doc[pi]
        infos = []
        try:
            raw = page.get_image_info()
        except Exception:
            return []
        for idx, info in enumerate(raw):
            x0, y0, x1, y1 = info["bbox"]
            w, h = x1 - x0, y1 - y0
            if w < 6 or h < 6:
                continue
            os.makedirs(img_dir, exist_ok=True)
            fname = "p%02d-i%02d.png" % (pi + 1, idx)
            fpath = os.path.join(img_dir, fname)
            if not os.path.exists(fpath):
                try:
                    import pymupdf as _f
                    clip = _f.Rect(x0, y0, x1, y1)
                    zoom = max(1.0, min(3.0, 900.0 / max(w, 1)))
                    pix = page.get_pixmap(matrix=_f.Matrix(zoom, zoom), clip=clip)
                    pix.save(fpath)
                except Exception:
                    continue
            infos.append({"top": y1, "x": x0, "w": w, "h": h,
                          "src": "assets/pdfimg/%s/%s" % (key, fname)})
        return infos

    def render_page(page, pi):
        rows = []  # {top, x, h, size, mono, bold, text} 或 {img: rel_path, top, w, h}
        for box in page:
            if not isinstance(box, LTTextBox):
                continue
            for ln in box:
                if not isinstance(ln, LTTextLine):
                    continue
                text = line_text(ln)
                if not text:
                    continue
                rows.append({
                    "top": ln.bbox[3], "x": ln.bbox[0],
                    "h": ln.height or 12.0,
                    "size": line_size(ln) or 12.0,
                    "mono": line_mono(ln),
                    "bold": line_bold(ln),
                    "text": text,
                })
        # 内嵌图片（公式等）按版面位置并入行流
        page_area = abs(page.width * page.height) if hasattr(page, "width") else 0
        for img in page_images(pi):
            w, h = img["w"], img["h"]
            if w < 6 or h < 6:
                continue
            if page_area and (w * h) > page_area * 0.85:
                continue  # 整页背景
            rows.append({"img": img["src"], "top": img["top"], "x": img["x"],
                         "h": h, "w": w, "size": 0.0, "mono": False, "bold": False,
                         "text": ""})
        if not rows:
            return None
        rows.sort(key=lambda r: (-r["top"], r["x"]))

        body_size = collections.Counter(round(r["size"]) for r in rows).most_common(1)[0][0] or 12.0

        out = []
        block = None  # {"kind": "p"|"h3"|"h4", "x","h","text"} —— 标题与正文统一走延续合并
        code = []     # [escaped line, ...]
        lis = []      # [{"x","h","text"}]

        def flush_block():
            nonlocal block
            if block:
                out.append("<%s>%s</%s>" % (block["kind"], esc_html(block["text"]), block["kind"]))
                block = None

        def flush_code():
            nonlocal code
            if code:
                out.append("<pre><code>" + "\n".join(code) + "</code></pre>")
                code = []

        def flush_list():
            nonlocal lis
            if lis:
                out.append("<ul>" + "".join("<li>" + esc_html(li["text"]) + "</li>" for li in lis) + "</ul>")
                lis = []

        def flush_all():
            flush_block(); flush_code(); flush_list()

        prev = None
        for r in rows:
            # ---- 图片行：公式/插图，按位置插入，打断当前块 ----
            if r.get("img"):
                flush_all()
                out.append('<figure class="img-card"><img src="%s" alt="公式/插图" loading="lazy"></figure>' % r["img"])
                prev = r
                continue
            text = r["text"]
            gap = (prev["top"] - r["top"]) if prev else r["h"]
            max_h = max(prev["h"], r["h"]) if prev else r["h"]

            # ---- 分类（优先级：代码 > 标题 > 列表 > 正文）----
            ascii_only = all(ord(c) < 128 for c in text)
            sym_n = len(RE_CODE_SYM.findall(text))
            is_code = (
                r["mono"]
                or text.startswith(("#", "//"))
                or (ascii_only and sym_n >= 2 and not text.endswith("."))
            )

            size_ratio = r["size"] / body_size if body_size else 1.0
            has_bul = bool(RE_BULLET.match(text))
            has_num = bool(RE_NUM_PREFIX.match(text))
            # 标题：字号明显放大或加粗；编号式行（一、/1.）在放大/加粗时按标题处理。
            # 加粗信号排除陈述句（以句号/分号收束），但保留问句——题库标题多为问句。
            is_head = (
                not has_bul
                and len(text) <= 60
                and not text.endswith("：")
                and (
                    size_ratio >= 1.18
                    or (r["bold"] and len(text) <= 40 and not re.search(r"[。；…」』）]$", text))
                )
            )
            # 极短的标题候选行（如跨行标题的尾巴）不单独成块，交给标题延续合并
            is_head_tail = is_head and len(text) <= 8
            is_bul = (has_bul or has_num) and not is_head

            # ---- 块延续（标题/正文统一）：同列、行距小、上行未以强标点收束 ----
            if (
                block is not None
                and block["kind"] in ("p", "h3", "h4")
                and (not is_bul and not is_head and not is_code or is_head_tail)
                and gap < max_h * 1.9
                and abs(r["x"] - block["x"]) < 25
                and (block["kind"] != "p" or not RE_STRONG_END.search(block["text"]))
            ):
                block["text"] = join_text(block["text"], text)
                block["h"] = max(block["h"], r["h"])
                prev = r
                continue

            # ---- 列表项延续：列表开启中、正文行、缩进更深、行距小 ----
            if (
                lis
                and not is_bul and not is_head and not is_code
                and gap < max_h * 1.7
                and r["x"] >= lis[-1]["x"] + 6
            ):
                lis[-1]["text"] = join_text(lis[-1]["text"], text)
                prev = r
                continue

            # ---- 新块开始 ----
            flush_all()
            if is_head:
                kind = "h3" if (size_ratio >= 1.28 or has_num or r["bold"]) else "h4"
                block = {"kind": kind, "x": r["x"], "h": r["h"], "text": text}
            elif is_bul:
                lis.append({"x": r["x"], "h": r["h"],
                            "text": RE_BULLET.sub("", text, count=1)})
            elif is_code:
                code.append(esc_html(text))
            else:
                block = {"kind": "p", "x": r["x"], "h": r["h"], "text": text}
            prev = r

        flush_all()
        return "".join(out)

    parts = []
    text_pages = 0
    img_pages = 0

    def page_is_blank(pi):
        """真空白页：无文字、无内嵌图；若仍存疑，用渲染页图的像素方差判定（纯色装饰页）。"""
        doc = fitz_doc()
        if not doc or pi >= doc.page_count:
            return False
        pg = doc[pi]
        if (pg.get_text("text") or "").strip():
            return False
        try:
            if pg.get_image_info():
                return False
        except Exception:
            pass
        # 无文字无图：若渲染页图接近纯色（std<4）也视为空白
        if pi < len(pages_img):
            try:
                from PIL import Image
                import statistics
                img = Image.open(os.path.join(BASE, "assets", "pdfpages", key, pages_img[pi])).convert("L")
                small = img.resize((64, 64))
                px = list(small.getdata())
                if statistics.pstdev(px) < 4:
                    return True
            except Exception:
                pass
        # 无文字无图且无矢量绘图
        try:
            if pg.get_drawings():
                return False
        except Exception:
            pass
        return True

    for pi, page in enumerate(pages):
        body = render_page(page, pi)
        if body and len(body) > 80:
            parts.append('<section class="pdf-page-section">' + body + '</section>')
            text_pages += 1
        elif page_is_blank(pi):
            continue  # 空白页直接跳过，不嵌入空白页图
        elif pi < len(pages_img):
            parts.append('<figure class="pdf-page"><img src="assets/pdfpages/%s/%s" alt="第%d页" loading="lazy"></figure>' % (key, pages_img[pi], pi + 1))
            img_pages += 1

    if not parts:
        return None, 0, 0
    return "".join(parts), text_pages, img_pages


def pdf_web_html(href):
    """PDF → 网页原生内容：使用 pdfminer.six 严格按版面还原。"""
    return _pdfminer_html(href)


def pdf_pages_html(href):
    """把本地 PDF 渲染出的逐页图片转成正文 figure 序列；未渲染则返回 (None, 0)"""
    key = hashlib.sha1(os.path.basename(href).encode()).hexdigest()[:12]
    pdir = os.path.join(BASE, "assets", "pdfpages", key)
    if not os.path.exists(os.path.join(pdir, "done.txt")):
        return None, 0
    pages = sorted(f for f in os.listdir(pdir) if f.endswith(".jpg"))
    if not pages:
        return None, 0
    rel = "assets/pdfpages/" + key
    parts = []
    for p in pages:
        parts.append('<figure class="pdf-page"><img src="%s/%s" alt="PDF 页面" loading="lazy"></figure>' % (rel, p))
    return "".join(parts), len(pages)


def main():
    sections = build_tree()
    toc = json.load(open(os.path.join(RAW, "toc.json"), encoding="utf-8"))
    TOC_BY_SLUG = {t["url"]: t for t in toc if t["type"] == "DOC" and t.get("url")}
    docs_meta = []
    contents = OrderedDict()
    seen_slugs = set()

    def add_doc(d, path):
        if d["url"] in seen_slugs or d["url"] in DROP_SLUGS:
            return
        seen_slugs.add(d["url"])
        docs_meta.append({
            "slug": d["url"],
            "title": sanitize_brand(d["title"]),
            "section": sanitize_brand(path),
            "level": d.get("level", 2),
        })

    def walk_items(items, path):
        for it in items:
            if isinstance(it, str):
                ent = TOC_BY_SLUG.get(it)
                if ent:
                    add_doc(ent, path)
            else:
                walk_items(it["items"], (path + " / " + it["title"]) if path else it["title"])

    for sec in sections:
        walk_items(sec["items"], sec["title"])

    # 组内顺序重编号：源站编号有大量空洞（1,23,26,52,86…），按显示顺序重排为 1..K 连续序号。
    # 只处理「数字+分隔符」开头的标题；统一为自然数（不补零）；保留原分隔符；无编号文档不占号。
    title_new = {}
    title_old = {}
    orig_no = {}

    def renumber(items):
        idx = 0
        for it in items:
            if isinstance(it, dict):
                renumber(it["items"])
                continue
            ent = TOC_BY_SLUG.get(it)
            if not ent:
                continue
            m = re.match(r"^(\s*)(0*\d+)([\.、．])\s*(.*)$", ent.get("title", ""))
            if not m:
                continue
            idx += 1
            orig_no[it] = int(m.group(2))
            title_new[it] = m.group(1) + str(idx) + m.group(3) + m.group(4)
            title_old[it] = ent.get("title", "")

    for sec in sections:
        renumber(sec["items"])
    for m in docs_meta:
        if m["slug"] in title_new:
            m["orig"] = orig_no[m["slug"]]
            m["title"] = sanitize_brand(title_new[m["slug"]])
    print("renumbered:", len(title_new))

    # 正文标题同步：转换后的正文常以「旧编号+标题」作为首标题(h1/p)，
    # 仅当整段纯文本与旧标题完全一致时，替换为带新编号的标题（纯字符串操作，不全局序列化）。
    html_unescape = __import__("html").unescape
    _strip_no = lambda t: re.sub(r"^\s*\d+[\.、．]\s*", "", t).strip()

    def sync_doc_title(html, old, new):
        """正文首标题与目录编号一致化。命中条件（二选一）：
        1) 整段纯文本 == 旧标题全串；
        2) 整段以任意数字前缀开头，且去掉前缀后的主体 == 新标题主体（语雀正文标题可异于目录标题）。
        仅替换首个匹配的 h1/h2/h3/p 元素，纯字符串操作不触碰其余内容。"""
        if not old or not new or old == new:
            return html
        new_body = _strip_no(new)
        if not new_body:
            return html
        pat = re.compile(r"<(h[123]|p)([^>]*)>(.*?)</\1>", re.S)
        for m in pat.finditer(html):
            plain = html_unescape(re.sub(r"<[^>]+>", "", m.group(3))).strip()
            hit = (plain == old) or (re.match(r"^\s*\d+[\.、．]", plain) and _strip_no(plain) == new_body)
            if not hit:
                continue
            safe = re.sub(r"[&<>]", lambda c: {"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c.group()], new)
            return html[:m.start()] + "<" + m.group(1) + m.group(2) + ">" + safe + "</" + m.group(1) + ">" + html[m.end():]
        return html

    imgmap = {}
    imgmap_path = os.path.join(RAW, "imgmap.json")
    if os.path.exists(imgmap_path):
        imgmap = json.load(open(imgmap_path, encoding="utf-8"))
        print("imgmap entries:", len(imgmap))

    # attachments: url -> site-relative path
    attmap = {}
    att_src = os.path.join(RAW, "attachments")
    att_dst = os.path.join(BASE, "attachments")
    if os.path.isdir(att_src):
        os.makedirs(att_dst, exist_ok=True)
        import shutil
        for fn in os.listdir(att_src):
            if fn.endswith(".url"):
                continue
            u = open(os.path.join(att_src, fn + ".url"), encoding="utf-8").read().strip() if \
                os.path.exists(os.path.join(att_src, fn + ".url")) else ""
            dst = os.path.join(att_dst, fn)
            if not os.path.exists(dst):
                shutil.copy2(os.path.join(att_src, fn), dst)
            if u:
                attmap[u] = "attachments/" + fn
        print("attachments localized:", len(attmap))

    dead = set()
    dead_path = os.path.join(RAW, "dead.json")
    if os.path.exists(dead_path):
        dead = set(json.load(open(dead_path, encoding="utf-8")))

    ok, empty = 0, 0
    for i, m in enumerate(docs_meta):
        path = os.path.join(RAW, "docs", m["slug"] + ".json")
        if not os.path.exists(path):
            m["missing"] = True
            if m["slug"] in dead:
                m["dead"] = True
                contents[m["slug"]] = {"html": '<p class="missing-doc">该文档在源知识库中已删除或未发布（404）。</p>', "outline": [], "text": ""}
            else:
                contents[m["slug"]] = {"html": '<p class="missing-doc">该文档尚未抓取到，可重新运行抓取。</p>', "outline": [], "text": ""}
            continue
        d = json.load(open(path, encoding="utf-8"))
        html, outline, text = convert(d.get("content", ""), imgmap, attmap)
        # 正文标题与目录重编号保持一致（旧编号全串精确匹配才替换）
        if m["slug"] in title_old:
            html = sync_doc_title(html, sanitize_brand(title_old[m["slug"]]), sanitize_brand(title_new[m["slug"]]))
        contents[m["slug"]] = {"html": html, "outline": outline, "text": text}
        # 附件型正文：PDF 逐页原图直接平铺（零二次点击），zip 保留卡片
        att_tags = re.findall(r'<a class="attachment"[^>]*>.*?</a>', html)
        if att_tags and len(re.sub(r"<[^>]+>", "", html).strip()) < 400:
            entry = {"html": html, "outline": outline, "text": text}
            atts = []
            for tag in att_tags:
                href_m = re.search(r'href="([^"]+)"', tag)
                meta_m = re.search(r'data-meta="([^"]*)"', tag)
                name_m = re.search(r'>([^<]+)</a>', tag)
                if href_m:
                    atts.append({"href": href_m.group(1),
                                 "meta": meta_m.group(1) if meta_m else "",
                                 "name": name_m.group(1) if name_m else "附件"})
            parts = []
            head_extra = []
            # 专题八（行业落地）为设计型 PDF，版面解析必然失真 → 按用户要求直接逐页原图平铺
            force_pages = m.get("section", "").startswith("专题八")
            for a in atts:
                if a["href"].endswith(".pdf"):
                    web = None
                    if force_pages:
                        pages_html, n_pages = pdf_pages_html(a["href"])
                        if pages_html:
                            m["pages"] = m.get("pages") or n_pages
                            head_extra.append(
                                '<div class="pdf-origin"><span>本篇为原版 PDF 逐页展示（原文 ' + a["name"] + " · " + a["meta"] + " · 共 " + str(n_pages) + " 页）</span>" +
                                '<span class="pdf-origin-actions"><a href="' + a["href"] + '" target="_blank" rel="noopener">原版 PDF</a><a href="' + a["href"] + '" download>下载</a></span></div>')
                            parts.append(pages_html)
                            web = ("", 0, 0)
                    if not web:
                        web = pdf_web_html(a["href"])
                    if web and web[0]:
                        html_body, text_pages, img_pages = web
                        m["pages"] = m.get("pages") or text_pages + img_pages
                        mode = "网页排版" if img_pages == 0 else ("图文混排" if text_pages > 0 else "原图版式")
                        head_extra.append(
                            '<div class="pdf-origin"><span>本篇已转为' + mode + "（原文 " + a["name"] + " · " + a["meta"] + " · 共 " + str(text_pages + img_pages) + " 页）</span>" +
                            '<span class="pdf-origin-actions"><a href="' + a["href"] + '" target="_blank" rel="noopener">原版 PDF</a><a href="' + a["href"] + '" download>下载</a></span></div>')
                        parts.append(html_body)
                    elif not web or not web[0]:
                        head_extra.append(
                            '<div class="pdf-origin"><span>' + a["name"] + " · " + a["meta"] + "</span>" +
                            '<span class="pdf-origin-actions"><a href="' + a["href"] + '" target="_blank" rel="noopener">打开 PDF</a></span></div>')
                else:
                    parts.append('<p><a class="attachment" href="%s" target="_blank" data-meta="%s">%s</a></p>' % (a["href"], a["meta"], a["name"]))
            entry["html"] = "".join(head_extra) + "".join(parts)
            # PDF 文本进搜索索引
            extra = []
            for a in atts:
                if a["href"].endswith(".pdf"):
                    local = os.path.join(BASE, a["href"])
                    if os.path.exists(local):
                        extra.append(pdf_search_text(local))
            joined = " ".join(x for x in extra if x)
            if joined:
                entry["text"] = (text + " " + joined).strip()
                m["words"] = len(joined)
            contents[m["slug"]] = entry
        m["words"] = d.get("word_count") or len(text)
        if not html.strip():
            empty += 1
        else:
            ok += 1

    # sections structure for the sidebar
    sec_out = [{"title": s["title"], "items": s["items"]} for s in sections]

    meta = {
        "book": "格物 · 大模型知识库",
        "edition": "2026",
        "total": len(docs_meta),
        "okDocs": ok,
        "sections": sec_out,
        "docs": docs_meta,
    }
    with open(os.path.join(DATA, "meta.js"), "w", encoding="utf-8") as f:
        f.write("window.__META=")
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")

    # chunks: ~1.6MB html budget each
    CHUNK_BUDGET = 1_600_000
    chunk_idx = 0
    cur = {}
    cur_size = 0
    doc_chunk = {}
    for slug, c in contents.items():
        blob = json.dumps(c, ensure_ascii=False, separators=(",", ":"))
        doc_chunk[slug] = chunk_idx
        cur[slug] = c
        cur_size += len(blob)
        if cur_size >= CHUNK_BUDGET:
            write_chunk(chunk_idx, cur)
            chunk_idx += 1
            cur = {}
            cur_size = 0
    if cur:
        write_chunk(chunk_idx, cur)
        chunk_idx += 1

    with open(os.path.join(DATA, "docmap.js"), "w", encoding="utf-8") as f:
        f.write("window.__DOC_CHUNK=")
        json.dump(doc_chunk, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")

    # search part count marker (written after parts are known; patched later)
    search_count_path = os.path.join(DATA, "search_count.js")

    # search split files (plain text), ~2MB each
    SEARCH_BUDGET = 2_000_000
    parts = []
    cur_entries = []
    cur_len = 0
    for m in docs_meta:
        c = contents[m["slug"]]
        entry_text = (c.get("text") or "")[:20000]
        cur_entries.append([m["slug"], m["title"], m["section"], entry_text])
        cur_len += len(entry_text) + len(m["title"]) * 2
        if cur_len >= SEARCH_BUDGET:
            parts.append(cur_entries)
            cur_entries = []
            cur_len = 0
    if cur_entries:
        parts.append(cur_entries)
    for i, p in enumerate(parts):
        with open(os.path.join(DATA, "search_%02d.js" % i), "w", encoding="utf-8") as f:
            f.write('(window.__SEARCH_PARTS=window.__SEARCH_PARTS||{})[%d]=' % i)
            json.dump(p, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";")
    with open(search_count_path, "w", encoding="utf-8") as f:
        f.write("window.__SEARCH_COUNT=%d;" % len(parts))

    print("docs total=%d ok=%d empty=%d missing=%d chunks=%d searchparts=%d"
          % (len(docs_meta), ok, empty, sum(1 for m in docs_meta if m.get("missing")), chunk_idx, len(parts)))


def write_chunk(idx, cur):
    with open(os.path.join(DATA, "chunk_%02d.js" % idx), "w", encoding="utf-8") as f:
        f.write("(window.__CHUNKS=window.__CHUNKS||{})[%d]=" % idx)
        json.dump(cur, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")


if __name__ == "__main__":
    main()
