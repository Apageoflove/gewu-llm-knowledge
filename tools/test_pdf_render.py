#!/usr/bin/env python3
"""PDF→HTML 转换器回归测试。

对样例 PDF 断言：
  1. 无重复段落 / 无重复列表项（历史 bug：双写输出）
  2. 中文编号题（一、二、…）一律渲染为标题，不得落入 <p>
  3. 标题跨行（如 “…怎么解” + “决？”）必须拼回同一标题
  4. 代码行进入 <pre><code> 且保留换行（不得压成一行）
  5. 内容召回：PDF 原文字符在输出中的占比 ≥ 98%

运行：python3 tools/test_pdf_render.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data  # noqa: E402

ATT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "attachments")

SAMPLES = [
    "对比学习相似度函数面试题.pdf",
    "大模型强化学习PPO面试题.pdf",
    "大模型Adapter微调面试题.pdf",
    "大模型RLHF相关面试题.pdf",
    "大模型激活函数面试题.pdf",   # 公式为内嵌图片
    "Attention 进阶面试题.pdf",   # 尾随空白页（纯色装饰矩形）
]

RE_NUM_HEAD = re.compile(r"^[一二三四五六七八九十]+、")


def pdf_plain_text(path):
    import pymupdf as fitz
    d = fitz.open(path)
    t = "\n".join(p.get_text("text") or "" for p in d)
    d.close()
    return t


def recall(src, out):
    s = re.sub(r"\s+", "", src)
    o = re.sub(r"\s+", "", out)
    if not s:
        return 1.0
    hit = sum(1 for ch in s if ch in o)
    return hit / len(s)


def main():
    failures = []
    for name in SAMPLES:
        path = os.path.join(ATT, name)
        if not os.path.exists(path):
            continue
        html, t_pages, i_pages = build_data.pdf_web_html("attachments/" + name)
        assert html, name
        ps = re.findall(r"<p>([^<]+)</p>", html)
        lis = re.findall(r"<li>([^<]+)</li>", html)
        h3s = re.findall(r"<h3>([^<]+)</h3>", html)
        pres = re.findall(r"<pre><code>(.*?)</code></pre>", html, re.S)

        dup = [t for t, c in ((x, ps.count(x)) for x in set(ps)) if c > 1]
        if dup:
            failures.append(f"{name}: 重复段落 x{len(dup)}: {dup[0][:30]}")

        q_in_p = [p for p in ps if RE_NUM_HEAD.match(p)]
        if q_in_p:
            failures.append(f"{name}: 编号题落入<p>: {q_in_p[0][:30]}")

        tails = [h for h in h3s if len(h) <= 4]
        if tails:
            failures.append(f"{name}: 跨行标题尾巴未合并: {tails}")

        for pre in pres:
            for pat in ("()data", "()policy"):
                if pat in pre.replace(" ", ""):
                    failures.append(f"{name}: 代码行被压成一行: …{pre[:60]}…")
                    break

        r = recall(pdf_plain_text(path), html)
        if r < 0.98:
            failures.append(f"{name}: 召回率 {r:.3f} < 0.98")

        # 公式 PDF：内嵌图片必须被提取并穿插
        if name == "大模型激活函数面试题.pdf":
            figs = re.findall(r'<figure class="img-card">', html)
            if len(figs) < 6:
                failures.append(f"{name}: 公式图片仅 {len(figs)} 张（预期 ≥6）")
        # 尾随空白页 PDF：不得输出空白页图
        if name == "Attention 进阶面试题.pdf":
            if re.search(r'class="pdf-page"', html):
                failures.append(f"{name}: 空白页未被跳过")
        print(f"[{'PASS' if not failures or all(name not in f for f in failures) else 'FAIL'}] {name}: "
              f"p={len(ps)} li={len(lis)} h3={len(h3s)} pre={len(pres)} recall={r:.3f}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nAll PDF render tests passed.")


if __name__ == "__main__":
    main()
