/* 格物 · 大模型知识库 SPA */
(function () {
  "use strict";

  var META = window.__META || { sections: [], docs: [] };
  var DOC_CHUNK = window.__DOC_CHUNK || {};
  var CHUNKS = (window.__CHUNKS = window.__CHUNKS || {});
  var CHUNK_STATE = {};   // idx -> 'loading' | 'ready'
  var docIndex = {};      // slug -> meta
  var docOrder = [];      // ordered slugs
  var currentSlug = null;
  var currentSection = null;

  var $ = function (id) { return document.getElementById(id); };
  var mainEl = $("main"), viewHome = $("view-home"), viewDoc = $("view-doc");
  var tocEl = $("toc"), outlineEl = $("outline"), outlineBody = $("outline-body");

  META.docs.forEach(function (d) { docIndex[d.slug] = d; });
  META.docs.forEach(function (d) { docOrder.push(d.slug); });

  /* ---------------- utils ---------------- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtWords(n) {
    if (!n) return "—";
    return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万字" : n + " 字";
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ---------------- theme ---------------- */
  var themeBtn = $("btn-theme");
  function applyTheme(t) {
    document.documentElement.classList.toggle("dark", t === "dark");
    try { localStorage.setItem("mirror-theme", t); } catch (e) {}
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("mirror-theme"); } catch (e) {}
  if (!savedTheme) savedTheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(savedTheme);
  themeBtn.addEventListener("click", function () {
    applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  });

  /* ---------------- chunk loader ---------------- */
  function loadChunk(idx, cb) {
    if (CHUNKS[idx]) { cb && cb(); return; }
    if (CHUNK_STATE[idx] === "loading") {
      document.addEventListener("chunk-ready-" + idx, function h() {
        document.removeEventListener("chunk-ready-" + idx, h);
        cb && cb();
      });
      return;
    }
    CHUNK_STATE[idx] = "loading";
    var s = document.createElement("script");
    s.src = "data/chunk_" + String(idx).padStart(2, "0") + ".js";
    s.onload = function () {
      CHUNK_STATE[idx] = "ready";
      document.dispatchEvent(new CustomEvent("chunk-ready-" + idx));
      cb && cb();
    };
    s.onerror = function () {
      CHUNK_STATE[idx] = null;
      cb && cb(new Error("分块加载失败：" + s.src));
    };
    document.head.appendChild(s);
  }

  /* ---------------- sidebar TOC ---------------- */
  function buildTOC() {
    tocEl.innerHTML = "";
    META.sections.forEach(function (sec) {
      var box = el("div", "toc-section" + (/^专题/.test(sec.title) ? "" : " toc-extra"));
      var head = el("button", "toc-section-head");
      head.type = "button";
      head.innerHTML =
        '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>' +
        '<span class="sec-title">' + esc(sec.title || "其他") + "</span>" +
        '<span class="sec-count">' + countItems(sec.items) + "</span>";
      head.title = sec.title; // 悬停显示完整板块名
      head.setAttribute("aria-expanded", "false");
      head.addEventListener("click", function () {
        box.classList.toggle("open");
        head.setAttribute("aria-expanded", box.classList.contains("open") ? "true" : "false");
      });
      box.appendChild(head);
      var group = el("div", "toc-group");
      appendItems(group, sec.items, 0);
      if (!countItems(sec.items)) {
        var hint = el("div", "toc-empty-hint");
        hint.textContent = "此分组在原知识库中暂无文档";
        group.appendChild(hint);
      }
      box.appendChild(group);
      tocEl.appendChild(box);
    });
    $("toc-count").textContent = META.docs.length + " 篇文档 · 全文离线可搜";
  }

  function appendItems(container, items, depth) {
    items.forEach(function (it) {
      if (typeof it === "string") {
        if (docIndex[it]) container.appendChild(docLink(it, depth > 0 ? "sub-doc" : ""));
        return;
      }
      // 分组：带子文档的文档（自身 + 子项）
      var subHead = el("button", "toc-sub-head");
      subHead.type = "button";
      subHead.title = it.title; // 悬停显示完整名称
      subHead.innerHTML = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><polyline points="9 6 15 12 9 18"/></svg><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.title) + "</span><span>" + countItems(it.items) + "</span>";
      subHead.addEventListener("click", function () {
        var ul = subHead.nextElementSibling;
        var open = ul.style.display !== "none";
        ul.style.display = open ? "none" : "block";
        subHead.classList.toggle("open", !open);
      });
      container.appendChild(subHead);
      var subBox = el("div", "toc-sub");
      appendItems(subBox, it.items, depth + 1);
      subBox.style.display = "none";
      container.appendChild(subBox);
    });
  }

  function countItems(items) {
    var n = 0;
    (items || []).forEach(function (it) {
      if (typeof it === "string") { if (docIndex[it]) n += 1; }
      else n += countItems(it.items);
    });
    return n;
  }
  function docLink(slug, extraCls) {
    var d = docIndex[slug];
    var a = el("a", "doc-item" + (extraCls ? " " + extraCls : ""));
    a.href = "#/" + slug;
    a.dataset.slug = slug;
    var t = d ? d.title : slug;
    a.title = t; // 侧栏变窄截断时悬停显示完整名称
    a.innerHTML = '<span class="item-text">' + esc(t) + "</span>";
    return a;
  }

  /* TOC filter */
  var tocFilter = $("toc-filter");
  var tocFilterClear = $("toc-filter-clear");
  tocFilter.addEventListener("input", function () {
    var q = tocFilter.value.trim().toLowerCase();
    tocFilterClear.hidden = !q;
    var any = false;
    tocEl.querySelectorAll(".doc-item").forEach(function (a) {
      var hit = !q || (a.textContent || "").toLowerCase().indexOf(q) >= 0;
      a.style.display = hit ? "" : "none";
      if (hit) any = true;
    });
    tocEl.querySelectorAll(".toc-section").forEach(function (sec) {
      var vis = sec.querySelector(".doc-item:not([style*='none'])");
      sec.style.display = vis ? "" : "none";
      if (q && vis) sec.classList.add("open");
    });
    var emptyMsg = tocEl.querySelector(".empty-filter");
    if (!any && !emptyMsg) tocEl.appendChild(el("div", "empty-filter", "没有匹配「" + esc(q) + "」的目录项"));
    if (emptyMsg && any) emptyMsg.remove();
    if (!q) {
      tocEl.querySelectorAll(".toc-section").forEach(function (sec) { sec.classList.remove("open"); });
      openActiveSection();
    }
  });
  tocFilterClear.addEventListener("click", function () {
    tocFilter.value = "";
    tocFilter.dispatchEvent(new Event("input"));
    tocFilter.focus();
  });

  function openActiveSection() {
    tocEl.querySelectorAll(".doc-item.active").forEach(function (a) {
      var sec = a.closest(".toc-section");
      if (sec) { sec.classList.add("open"); var h = sec.querySelector(".toc-section-head"); if (h) h.setAttribute("aria-expanded", "true"); }
      var sub = a.closest(".toc-sub");
      if (sub) { sub.style.display = "block"; }
    });
  }
  function setActiveTOC(slug) {
    tocEl.querySelectorAll(".doc-item.active").forEach(function (a) { a.classList.remove("active"); });
    var a = tocEl.querySelector('.doc-item[data-slug="' + slug + '"]');
    if (a) {
      a.classList.add("active");
      openActiveSection();
      var rect = a.getBoundingClientRect();
      var cont = tocEl.getBoundingClientRect();
      if (rect.bottom > cont.bottom + 60 || rect.top < cont.top - 60) {
        a.scrollIntoView({ block: "center" });
      }
    }
  }

  /* sidebar：移动端抽屉 / 桌面端折叠（状态记忆） */
  var sidebar = $("sidebar"), backdrop = $("sidebar-backdrop");
  function toggleSidebar(open) {
    if (window.innerWidth < 1024) {
      sidebar.classList.toggle("open", open);
      backdrop.hidden = !open;
      if (open) requestAnimationFrame(function () { backdrop.classList.add("show"); });
      else backdrop.classList.remove("show");
      return;
    }
    document.body.classList.toggle("sb-collapsed", !open);
    try { localStorage.setItem("gw-sidebar", open ? "open" : "collapsed"); } catch (e) {}
  }
  (function restoreSidebar() {
    try {
      if (localStorage.getItem("gw-sidebar") === "collapsed") {
        document.body.classList.add("sb-collapsed");
      }
    } catch (e) {}
  })();
  $("btn-sidebar").addEventListener("click", function () {
    if (window.innerWidth < 1024) toggleSidebar(!sidebar.classList.contains("open"));
    else toggleSidebar(document.body.classList.contains("sb-collapsed"));
  });
  backdrop.addEventListener("click", function () { toggleSidebar(false); });
  function closeDrawer() {
    if (window.innerWidth < 1024 && sidebar.classList.contains("open")) toggleSidebar(false);
  }

  /* ---------------- home view ---------------- */
  function renderHome() {
    var totalWords = 0;
    META.docs.forEach(function (d) { totalWords += d.words || 0; });
    var pdfDocs = 0;
    var html = '<div class="home-hero">' +
      '<span class="home-kicker"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>个人知识库 · 完整离线镜像</span>' +
      '<div class="hero-ghost" aria-hidden="true">格物</div>' +
      '<h1 class="home-title">格物致知，<br>把大模型的每一处<span class="wave">核心脉络</span>，<span class="ink-grad">尽收一册</span>。<img class="home-seal" src="assets/logo-seal.svg" alt="" aria-hidden="true"></h1>' +
      '<p class="home-sub">深度学习基础 · Transformer · 微调 · RAG · Agent · RLHF · 推理部署 · 分布式 · 多模态 · 企业落地 —— 近 30 个技术领域、约 150 万字的体系化深度解析，全部离线可读、全文可搜。</p>' +
      '<div class="hero-colophon" aria-hidden="true">' + META.sections.filter(function (x) { return /^专题/.test(x.title) && countItems(x.items) > 0; }).slice(0, 6).map(function (x) {
        var nm = x.title.replace(/^专题[一二三四五六七八九十]--?/, "");
        return '<span class="hc"><b>' + countItems(x.items) + '</b><span>' + esc(nm) + "</span></span>";
      }).join("") + "</div>" +
      '<div class="home-search" id="home-search">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>' +
      '<input type="text" id="home-search-input" placeholder="搜索题目或全文，如：LoRA 原理、注意力机制、RAG 优化…" autocomplete="off" spellcheck="false">' +
      "<button type=\"button\" id=\"home-search-btn\">搜 索</button></div>" +
      '<div class="home-stats">' +
      '<div class="stat"><b>' + META.docs.length + "<i>篇</i></b><span>深度解析文档</span></div>" +
      '<div class="stat"><b>' + (totalWords / 10000).toFixed(0) + "<i>万+</i></b><span>总字数</span></div>" +
      '<div class="stat"><b>' + META.sections.length + "<i>个</i></b><span>知识板块</span></div>" +
      '<div class="stat"><b>100<i>%</i></b><span>离线可读</span></div>' +
      "</div></div>";

    // 板块卡片（含预览文档；空分组如实展示为不可点卡片，序号连续）
    html += '<div class="home-sections"><h2 class="home-h2">知识版图</h2><p class="home-h2-sub">' + META.sections.length + ' 大板块 · 点击进入对应专题，或在左侧目录中浏览全部文档</p><div class="sec-grid' + (META.sections.length > 3 ? ' has-feature' : '') + '">';
    var cardNo = 0;
    META.sections.forEach(function (sec) {
      var first = firstDocOf(sec.items);
      var n = countItems(sec.items);
      cardNo += 1;
      if (!first) {
        html += '<div class="sec-card is-empty" style="--i:' + cardNo + '" aria-disabled="true">' +
          '<span class="sec-num" aria-hidden="true">' + String(cardNo).padStart(2, "0") + "</span>" +
          '<span class="sec-name">' + esc(sec.title) + "</span>" +
          '<span class="sec-meta">原知识库此分组暂无文档</span></div>';
        return;
      }
      var preview = previewDocs(sec.items, 3);
      var acc = cardNo % 3 === 1 ? " acc-2" : (cardNo % 3 === 2 ? " acc-3" : "");
      html += '<a class="sec-card' + acc + '" style="--i:' + cardNo + '" href="#/' + first + '">' +
        '<span class="sec-num" aria-hidden="true">' + String(cardNo).padStart(2, "0") + "</span>" +
        '<span class="sec-name">' + esc(sec.title) + "</span>" +
        '<span class="sec-meta">' + n + " 篇 · 从「" + esc(((docIndex[first] || {}).title || "").slice(0, 12)) + "」开始</span>" +
        '<span class="sec-go" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></span>';
      if (preview.length) {
        html += '<span class="sec-preview">';
        preview.forEach(function (p) { html += "<span>" + esc(p) + "</span>"; });
        html += "</span>";
      }
      html += "</a>";
    });
    html += "</div></div>";

    // 高频专题速览（取自专题分组；已按组内顺序重编号，取编号最小的首篇）
    var latest = META.docs
      .filter(function (d) { return d.orig && d.section && /^专题/.test(d.section.split(" / ")[0]); })
      .sort(function (a, b) { return (a.orig || 1e9) - (b.orig || 1e9); })
      .slice(0, 12);
    if (latest.length) {
      html += '<div class="home-latest"><h2 class="home-h2">高频专题速览</h2><p class="home-h2-sub">近期更新的深度解析 · 横向滑动查看更多</p><div class="latest-row">';
      latest.forEach(function (d, li) {
        html += '<a class="latest-card" style="--i:' + li + '" href="#/' + d.slug + '">' +
          '<span class="lc-tag">' + esc((d.section || "").split(" / ")[0]) + "</span>" +
          '<span class="lc-title">' + esc(d.title) + "</span></a>";
      });
      html += "</div></div>";
    }

    html += '<div class="home-note">个人知识库 · 全部内容本地离线可读可搜。<br>提示：左侧目录可筛选；绿色链接为站内跳转；代码块一键复制；图片点击放大；PDF 版篇目已自动转为网页排版（图片页内嵌高清原图）。</div>';
    html += '<footer class="home-footer"><span>格物 · 大模型知识库</span><span>本地镜像 · 数据快照 2026-09 · 共 ' + META.docs.length + " 篇</span></footer>";

    viewHome.innerHTML = html;

    var hsInput = $("home-search-input");
    $("home-search-btn").addEventListener("click", function () { openSearch(hsInput.value); });
    hsInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") openSearch(hsInput.value);
    });
  }

  function previewDocs(items, n) {
    var out = [];
    function walk(list) {
      for (var i = 0; i < list.length && out.length < n; i++) {
        var it = list[i];
        if (typeof it === "string") {
          if (docIndex[it]) out.push(docIndex[it].title);
        } else {
          walk(it.items);
        }
      }
    }
    walk(items || []);
    return out;
  }
  function firstDocOf(items) {
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      if (typeof it === "string") {
        if (docIndex[it]) return it;
      } else {
        var f = firstDocOf(it.items);
        if (f) return f;
      }
    }
    return null;
  }

  /* ---------------- doc view ---------------- */
  var docEl = $("doc");
  function renderDoc(slug, anchor) {
    currentSlug = slug;
    var meta = docIndex[slug];
    setActiveTOC(slug);
    updateCrumb(meta);

    viewDoc.hidden = false;
    viewHome.hidden = true;

    var idx = DOC_CHUNK[slug];
    if (idx == null) {
      docEl.innerHTML = '<p class="missing-doc">未找到该文档的数据。</p>';
      outlineEl.hidden = true;
      finishRender(anchor);
      return;
    }
    if (!CHUNKS[idx]) {
      docEl.innerHTML = skeleton();
      loadChunk(idx, function (err) {
        if (err) { docEl.innerHTML = '<p class="missing-doc">' + esc(err.message) + "</p>"; return; }
        if (currentSlug === slug) renderDocNow(slug, anchor);
      });
      return;
    }
    renderDocNow(slug, anchor);
  }

  function renderDocNow(slug, anchor) {
    var meta = docIndex[slug];
    var data = (CHUNKS[DOC_CHUNK[slug]] || {})[slug] || { html: "", outline: [], text: "" };

    var words = meta.words || (data.text || "").length;
    var readMin = Math.max(1, Math.round(words / 400));
    var pagesTag = meta.pages ? '<span>共 ' + meta.pages + " 页 · PDF</span><span class='dot'>·</span>" : "";

    var headHtml = '<header class="doc-head">' +
      (meta.section ? '<a class="doc-section-label" href="#/">' + esc(meta.section) + "</a>" : "") +
      '<h1 class="doc-title">' + esc(meta.title) + "</h1>" +
      '<div class="doc-meta">' + pagesTag +
      "<span>" + fmtWords(words) + "</span><span class='dot'>·</span>" +
      "<span>约 " + readMin + " 分钟</span>" +
      (meta.missing ? "<span class='dot'>·</span><span style='color:var(--destructive,#b3261e)'>未抓取到</span>" : "") +
      '<button type="button" id="bookmark-btn" class="bookmark-btn" title="加入书签，下次自动续读"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>' +
      '<button type="button" id="margin-toggle" class="notes-toggle' + (document.body.classList.contains("margin-collapsed") ? "" : " on") + '" title="展开/折叠侧边批注">批注</button>' +
      '<button type="button" id="fav-star" class="fav-star" title="收藏本篇">★</button>' +
      "</div></header>";

    docEl.innerHTML = headHtml + '<div class="doc-body">' + data.html + "</div>" + navHtml(slug);
    // 空文档占位：源知识库本身即空白页（word_count=0，无卡片/图片/代码），给出诚实提示而非留白
    var bodyEl = docEl.querySelector(".doc-body");
    if (bodyEl && !(data.text || "").replace(/\s+/g, "") && !bodyEl.querySelector("img, iframe, .codeblock, .pdf-page, .img-card, a")) {
      bodyEl.innerHTML =
        '<div class="doc-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>' +
        "<p>这一篇在原知识库中是空白占位页，没有正文内容。</p>" +
        '<p class="sub">试试左侧目录中的相邻文档，或用右上角搜索查找相关主题。</p>' +
        "</div>";
    }
    var hasPdf = !!docEl.querySelector(".pdf-page");
    viewDoc.classList.toggle("has-pdf", hasPdf);
    document.querySelector(".layout").classList.toggle("pdf-mode", hasPdf);
    if (hasPdf) outlineEl.hidden = true;

    // 收藏星标 + 书签 + 批注折叠 + 标注重放
    var favBtn = document.getElementById("fav-star");
    if (favBtn) {
      updateFavStar();
      favBtn.addEventListener("click", function () { toggleFav(slug); updateFavStar(); });
    }
    var bmBtn = document.getElementById("bookmark-btn");
    if (bmBtn) {
      updateBookmarkBtn();
      bmBtn.addEventListener("click", toggleBookmark);
    }
    var mtBtn = document.getElementById("margin-toggle");
    if (mtBtn) {
      mtBtn.addEventListener("click", function () {
        var collapsed = document.body.classList.toggle("margin-collapsed");
        mtBtn.classList.toggle("on", !collapsed);
        try { localStorage.setItem("gw-margin", collapsed ? "collapsed" : "open"); } catch (e) {}
      });
    }
    applyHighlights(slug);
    renderMarginNotes();
    observeMargin();

    // anchors on h2/h3
    docEl.querySelectorAll(".doc-body h2[id], .doc-body h3[id]").forEach(function (h) {
      var a = el("a", "anchor", "#");
      a.href = "#/" + slug + "@" + h.id;
      a.setAttribute("aria-label", "锚点 " + h.textContent);
      a.addEventListener("click", function (e) { e.preventDefault(); historyReplace("#/" + slug + "@" + h.id); });
      h.appendChild(a);
    });

    // copy buttons
    docEl.querySelectorAll(".code-block").forEach(function (pre) {
      var btn = el("button", "copy-btn",
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span>');
      btn.type = "button";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        navigator.clipboard.writeText(code ? code.innerText : "").then(function () {
          btn.classList.add("done");
          btn.querySelector("span").textContent = "已复制";
          setTimeout(function () { btn.classList.remove("done"); btn.querySelector("span").textContent = "复制"; }, 1600);
        });
      });
      pre.appendChild(btn);
    });

    // outline
    renderOutline(data.outline || []);

    finishRender(anchor);
    preloadNeighbors(slug);
  }

  function finishRender(anchor) {
    mainEl.scrollTop = 0;
    window.scrollTo(0, 0);
    var view = viewDoc.hidden ? viewHome : viewDoc;
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
    updateProgress();
    if (anchor) {
      var target = docEl.querySelector('[id="' + anchor + '"]');
      if (target) setTimeout(function () { target.scrollIntoView({ block: "start" }); }, 60);
    }
    closeDrawer();
  }

  function navHtml(slug) {
    var i = docOrder.indexOf(slug);
    var prev = i > 0 ? docIndex[docOrder[i - 1]] : null;
    var next = i >= 0 && i < docOrder.length - 1 ? docIndex[docOrder[i + 1]] : null;
    var html = '<nav class="doc-nav">';
    html += prev
      ? '<a class="prev" href="#/' + prev.slug + '"><span class="nav-label">上一篇</span><span class="nav-title">' + esc(prev.title) + "</span></a>"
      : "<span></span>";
    html += next
      ? '<a class="next" href="#/' + next.slug + '"><span class="nav-label">下一篇</span><span class="nav-title">' + esc(next.title) + "</span></a>"
      : "<span></span>";
    return html + "</nav>";
  }

  function skeleton() {
    var h = '<div class="doc-skeleton"><div class="sk-line sk-title"></div>';
    for (var i = 0; i < 8; i++) h += '<div class="sk-line" style="width:' + (92 - (i % 4) * 14) + '%"></div>';
    return h + "</div>";
  }

  function updateCrumb(meta) {
    var crumb = $("crumb");
    if (!meta) { crumb.innerHTML = ""; return; }
    var parts = (meta.section || "").split(" / ").filter(Boolean);
    var html = "";
    parts.forEach(function (p, i) {
      html += (i ? '<span class="crumb-sep">/</span>' : "") + "<span>" + esc(p) + "</span>";
    });
    html += '<span class="crumb-sep">/</span><span class="crumb-cur">' + esc(meta.title) + "</span>";
    crumb.innerHTML = html;
  }

  /* outline + scrollspy */
  var spyLinks = [];
  function renderOutline(outline) {
    if (!outline.length) { outlineEl.hidden = true; outlineBody.innerHTML = ""; spyLinks = []; return; }
    outlineEl.hidden = false;
    var html = "";
    outline.forEach(function (o) {
      if (o.level < 2) return;
      html += '<a class="lvl-' + o.level + '" data-target="' + o.id + '" href="#/' + currentSlug + "@" + o.id + '">' + esc(o.text) + "</a>";
    });
    outlineBody.innerHTML = html || "";
    spyLinks = Array.prototype.slice.call(outlineBody.querySelectorAll("a"));
    spyLinks.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var t = docEl.querySelector('[id="' + a.dataset.target + '"]');
        if (t) t.scrollIntoView({ block: "start" });
        historyReplace("#/" + currentSlug + "@" + a.dataset.target);
      });
    });
  }
  var spyTimer = null;
  function scrollSpy() {
    if (spyTimer) return;
    spyTimer = requestAnimationFrame(function () {
      spyTimer = null;
      if (!spyLinks.length) return;
      var best = null, bestTop = -Infinity;
      var line = 96;
      spyLinks.forEach(function (a) {
        var t = docEl.querySelector('[id="' + a.dataset.target + '"]');
        if (!t) return;
        var top = t.getBoundingClientRect().top;
        if (top <= line && top > bestTop) { bestTop = top; best = a; }
      });
      if (!best && spyLinks.length) best = spyLinks[0];
      spyLinks.forEach(function (a) { a.classList.toggle("current", a === best); });
    });
  }

  /* progress + backtop */
  var progressBar = $("progress").firstElementChild;
  var backtop = $("backtop");
  function updateProgress() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0;
    progressBar.style.width = p + "%";
    backtop.hidden = h.scrollTop < 400;
    scrollSpy();
  }
  window.addEventListener("scroll", updateProgress, { passive: true });
  backtop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  /* preload neighbor chunks */
  function preloadNeighbors(slug) {
    var i = docOrder.indexOf(slug);
    var ids = [i - 1, i + 1].filter(function (x) { return x >= 0 && x < docOrder.length; }).map(function (x) { return DOC_CHUNK[docOrder[x]]; });
    setTimeout(function () {
      ids.forEach(function (idx) { if (idx != null && !CHUNKS[idx]) loadChunk(idx); });
    }, 600);
  }

  /* ---------------- router ---------------- */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "");
    if (!h) return { home: true };
    var at = h.split("@");
    return { slug: at[0], anchor: at[1] || null };
  }
  function historyReplace(hash) {
    history.replaceState(null, "", hash);
  }
  function route() {
    var r = parseHash();
    if (r.home || !docIndex[r.slug]) {
      currentSlug = null;
      viewDoc.hidden = true;
      viewHome.hidden = false;
      setActiveTOC(null);
      updateCrumb(null);
      outlineEl.hidden = true;
      var view = viewHome;
      view.classList.remove("view-enter");
      void view.offsetWidth;
      view.classList.add("view-enter");
      window.scrollTo(0, 0);
      updateProgress();
      closeDrawer();
      updateBmFab();
      document.title = META.book + " · " + META.edition;
      return;
    }
    document.title = docIndex[r.slug].title + " · " + META.book;
    renderDoc(r.slug, r.anchor);
    updateBookmarkBtn();
    updateBmFab();
  }
  window.addEventListener("hashchange", route);

  /* ---------------- search ---------------- */
  var searchModal = $("search-modal"), searchInput = $("search-input"), searchResults = $("search-results"), searchStat = $("search-stat");
  var searchPartsLoaded = false;
  var searchLoading = false;
  var selIdx = 0, resultItems = [];

  function ensureSearchData(cb) {
    if (searchPartsLoaded) { cb(); return; }
    if (searchLoading) { setTimeout(function () { ensureSearchData(cb); }, 200); return; }
    searchLoading = true;
    searchResults.innerHTML = '<div class="search-empty"><b>正在装载全文索引…</b>首次搜索需加载一次，之后常驻内存</div>';
    var parts = window.__SEARCH_PARTS || {};
    var keys = Object.keys(parts);
    var pending = keys.length;
    // search part files lazy: read manifest count from meta
    var count = window.__SEARCH_COUNT || 0;
    if (!count) {
      // discover via docmap length heuristics: try loading search_00.. until 404? we ship count in meta
    }
    var total = count || keys.length;
    if (total === 0) {
      // load first to detect
      loadSearchPart(0, function () {
        total = window.__SEARCH_COUNT || Object.keys(window.__SEARCH_PARTS || {}).length;
        finish();
      });
      return;
    }
    var done = 0;
    function after() { done++; if (done >= total) finish(); }
    for (var i = 0; i < total; i++) loadSearchPart(i, after);
    function finish() {
      searchPartsLoaded = true;
      searchLoading = false;
      cb();
    }
  }
  function loadSearchPart(i, cb) {
    if ((window.__SEARCH_PARTS || {})[i]) { cb(); return; }
    var s = document.createElement("script");
    s.src = "data/search_" + String(i).padStart(2, "0") + ".js";
    s.onload = function () { cb(); };
    s.onerror = function () { cb(); };
    document.head.appendChild(s);
  }

  function openSearch(initialQuery) {
    searchModal.hidden = false;
    document.body.style.overflow = "hidden";
    if (initialQuery != null && initialQuery.trim()) {
      searchInput.value = initialQuery.trim();
    }
    setTimeout(function () { searchInput.focus(); searchInput.select(); }, 30);
    ensureSearchData(function () { if (searchInput.value) runSearch(); });
  }
  function closeSearch() {
    searchModal.hidden = true;
    document.body.style.overflow = "";
  }
  $("btn-search").addEventListener("click", openSearch);
  searchModal.querySelectorAll("[data-close]").forEach(function (e) { e.addEventListener("click", closeSearch); });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      searchModal.hidden ? openSearch() : closeSearch();
    } else if (e.key === "Escape") {
      if (!searchModal.hidden) closeSearch();
      else if (!$("lightbox").hidden) closeLightbox();
      else if (noteModal && !noteModal.hidden) closeNoteModal();
      else if (notesPanel && !notesPanel.hidden) notesPanel.hidden = true;
      else if (authModal && !authModal.hidden) authModal.hidden = true;
      else if (adminModal && !adminModal.hidden) adminModal.hidden = true;
    } else if (!searchModal.hidden) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        moveSel(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        if (resultItems[selIdx]) { closeSearch(); location.hash = resultItems[selIdx].dataset.href; }
      }    }
  });

  function moveSel(d) {
    if (!resultItems.length) return;
    resultItems[selIdx] && resultItems[selIdx].classList.remove("sel");
    selIdx = (selIdx + d + resultItems.length) % resultItems.length;
    resultItems[selIdx].classList.add("sel");
    resultItems[selIdx].scrollIntoView({ block: "nearest" });
  }

  var searchTimer = null;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 160);
  });

  function highlight(text, q) {
    var low = text.toLowerCase(), i = low.indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<mark>" + esc(text.substr(i, q.length)) + "</mark>" + esc(text.slice(i + q.length));
  }
  function snippet(text, q) {
    var low = text.toLowerCase(), i = low.indexOf(q);
    if (i < 0) return esc(text.slice(0, 90));
    var start = Math.max(0, i - 36);
    return (start > 0 ? "…" : "") + highlight(text.substr(start, q.length + 72), q);
  }

  function runSearch() {
    var q = searchInput.value.trim().toLowerCase();
    var terms = q.split(/\s+/).filter(Boolean);
    if (!q || !terms.length) {
      searchResults.innerHTML = '<div class="search-empty"><b>全文搜索</b>输入关键词，如「LoRA」「注意力机制」「RAG 优化」</div>';
      searchStat.textContent = "";
      resultItems = [];
      return;
    }
    ensureSearchData(function () {
      var results = [];
      var parts = window.__SEARCH_PARTS || {};
      Object.keys(parts).forEach(function (k) {
        parts[k].forEach(function (entry) {
          var slug = entry[0], title = entry[1], sec = entry[2], text = entry[3];
          var tLow = title.toLowerCase(), sLow = (sec || "").toLowerCase(), xLow = text.toLowerCase();
          var score = 0, firstHit = -1;
          for (var ti = 0; ti < terms.length; ti++) {
            var t = terms[ti];
            var inTitle = tLow.indexOf(t) >= 0;
            var inSec = sLow.indexOf(t) >= 0;
            var inText = xLow.indexOf(t) >= 0;
            if (!inTitle && !inSec && !inText) { score = 0; break; }
            if (inTitle) score += 60;
            if (inSec) score += 20;
            if (inText) {
              score += 10;
              var fi = xLow.indexOf(t);
              if (firstHit < 0 || fi < firstHit) firstHit = fi;
            }
          }
          if (score > 0) results.push({ slug: slug, title: title, sec: sec, text: text, score: score, firstHit: firstHit });
        });
      });
      results.sort(function (a, b) { return b.score - a.score; });
      var top = results.slice(0, 60);
      searchStat.textContent = "命中 " + results.length + " 篇" + (results.length > 60 ? "（显示前 60）" : "");
      if (!top.length) {
        searchResults.innerHTML = '<div class="search-empty"><b>没有找到相关内容</b>换个关键词试试，如英文术语或更短的词</div>';
        resultItems = [];
        return;
      }
      var frag = document.createDocumentFragment();
      top.forEach(function (r) {
        var a = el("a", "sr-item");
        a.href = "#/" + r.slug;
        a.dataset.href = "#/" + r.slug;
        var snip = r.firstHit >= 0 ? snippet(r.text, terms[0]) : esc((r.text || "").slice(0, 90));
        a.innerHTML = '<span class="sr-title">' + highlight(r.title, terms[0]) + "</span>" +
          '<span class="sr-snippet">' + snip + "</span>" +
          '<span class="sr-sec">' + esc(r.sec || "") + "</span>";
        a.addEventListener("click", function () { closeSearch(); });
        frag.appendChild(a);
      });
      searchResults.innerHTML = "";
      searchResults.appendChild(frag);
      resultItems = Array.prototype.slice.call(searchResults.querySelectorAll(".sr-item"));
      selIdx = 0;
      resultItems[0] && resultItems[0].classList.add("sel");
    });
  }

  /* ---------------- lightbox ---------------- */
  var lightbox = $("lightbox"), lightboxImg = $("lightbox-img"), lightboxCap = $("lightbox-cap");
  document.addEventListener("click", function (e) {
    var img = e.target.closest ? e.target.closest(".img-card img, .pdf-page img") : null;
    if (img) {
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt || "";
      var cap = img.parentElement && img.parentElement.querySelector("figcaption");
      lightboxCap.textContent = cap ? cap.textContent : (img.alt || "");
      lightboxCap.style.display = lightboxCap.textContent ? "" : "none";
      lightbox.hidden = false;
      document.body.style.overflow = "hidden";
    }
  });
  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = "";
    document.body.style.overflow = "";
  }
  lightbox.querySelectorAll("[data-close]").forEach(function (e) { e.addEventListener("click", closeLightbox); });

  /* ================= 统一存储层（登录=云端 / 未登录=本地） ================= */
  var FAI = { user: null, fav: [], notes: [], bookmark: null, ready: false };
  window.__FAI = FAI; // 调试/测试钩子

  function lsGet(key, dft) {
    try { return JSON.parse(localStorage.getItem("gw-" + key)) ?? dft; } catch (e) { return dft; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem("gw-" + key, JSON.stringify(val)); } catch (e) {}
  }
  function persistData(key, val) {
    if (FAI.user) {
      // 登录态：仅写云端（本机槽位专属于访客，避免跨账号串数据）
      fetch("/api/data/" + key, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(val)
      }).catch(function () {});
    } else {
      lsSet(key, val);
    }
  }
  function clearLocalData() {
    ["fav", "notes", "bookmark"].forEach(function (k) {
      try { localStorage.removeItem("gw-" + k); } catch (e) {}
    });
  }
  function loadStore(cb) {
    fetch("/api/me").then(function (r) { return r.json(); }).then(function (m) {
      if (m && m.ok) {
        FAI.user = m.user;
        return Promise.all(
          ["fav", "notes", "bookmark"].map(function (k) {
            return fetch("/api/data/" + k).then(function (r) { return r.json(); }).then(function (d) {
              return { k: k, v: d && d.ok ? d.value : null };
            });
          })
        );
      }
      return "local";
    }).then(function (res) {
      if (res === "local") {
        FAI.fav = lsGet("fav", []);
        FAI.notes = lsGet("notes", []);
        FAI.bookmark = lsGet("bookmark", null);
      } else {
        var remote = {};
        res.forEach(function (x) { remote[x.k] = x.v; });
        // 合并本地访客数据（按 id/slug 去重）后上云
        var localFav = lsGet("fav", []);
        var localNotes = lsGet("notes", []);
        FAI.fav = (remote.fav || []).slice();
        localFav.forEach(function (f) { if (!FAI.fav.some(function (x) { return x.slug === f.slug; })) FAI.fav.push(f); });
        FAI.notes = (remote.notes || []).slice();
        localNotes.forEach(function (n) { if (!FAI.notes.some(function (x) { return x.id === n.id; })) FAI.notes.push(n); });
        FAI.bookmark = remote.bookmark || lsGet("bookmark", null);
        persistData("fav", FAI.fav);
        persistData("notes", FAI.notes);
        persistData("bookmark", FAI.bookmark);
        clearLocalData(); // 本机访客数据已并入云端，清空槽位保证隔离
      }
      FAI.ready = true;
      cb && cb();
    }).catch(function (e) {
      FAI.fav = lsGet("fav", []);
      FAI.notes = lsGet("notes", []);
      FAI.bookmark = lsGet("bookmark", null);
      FAI.ready = true;
      cb && cb();
    });
  }

  /* ================= toast ================= */
  var toastEl = el("div", "toast");
  document.body.appendChild(toastEl);
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  /* ================= 认证 UI ================= */
  var authModal = el("div", "note-modal");
  authModal.id = "auth-modal";
  authModal.hidden = true;
  authModal.innerHTML =
    '<div class="note-backdrop" data-close></div>' +
    '<div class="note-card auth-card" role="dialog" aria-modal="true">' +
    '<p class="auth-intro">登录后收藏 / 标注 / 书签将保存到你的账号（云端隔离、跨设备同步）；游客数据仅存本机浏览器。</p>' +
    '<div class="auth-tabs">' +
    '<button type="button" class="auth-tab on" data-tab="login">登 录</button>' +
    '<button type="button" class="auth-tab" data-tab="register">注 册</button>' +
    "</div>" +
    '<div class="auth-field"><label>邮箱</label><input type="email" id="auth-email" placeholder="you@example.com" autocomplete="email"></div>' +
    '<div class="auth-field"><label>密码</label><input type="password" id="auth-pass" placeholder="至少 6 位" autocomplete="current-password"></div>' +
    '<div class="auth-err" id="auth-err"></div>' +
    '<div class="note-actions"><span class="spacer"></span>' +
    '<button type="button" class="btn-ghost" id="auth-cancel">暂不登录，先逛逛</button>' +
    '<button type="button" class="btn-primary" id="auth-submit">登 录</button>' +
    "</div></div>";
  document.body.appendChild(authModal);
  var authMode = "login";
  function setAuthMode(m) {
    authMode = m;
    authModal.querySelectorAll(".auth-tab").forEach(function (t) {
      t.classList.toggle("on", t.dataset.tab === m);
    });
    $("auth-submit").textContent = m === "login" ? "登 录" : "注 册";
    $("auth-err").textContent = "";
  }
  authModal.querySelectorAll(".auth-tab").forEach(function (t) {
    t.addEventListener("click", function () { setAuthMode(t.dataset.tab); });
  });
  authModal.querySelector("[data-close]").addEventListener("click", function () { authModal.hidden = true; });
  $("auth-cancel").addEventListener("click", function () {
    authModal.hidden = true;
    try { localStorage.setItem("gw-auth-seen", "1"); } catch (e) {}
  });
  function markAuthSeen() { try { localStorage.setItem("gw-auth-seen", "1"); } catch (e) {} }
  $("auth-email").addEventListener("keydown", function (e) { if (e.key === "Enter") $("auth-pass").focus(); });
  $("auth-pass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("auth-submit").click(); });
  $("auth-submit").addEventListener("click", function () {
    var email = $("auth-email").value.trim();
    var pass = $("auth-pass").value;
    $("auth-err").textContent = "";
    $("auth-submit").disabled = true;
    $("auth-submit").textContent = authMode === "login" ? "登录中…" : "注册中…";
    fetch("/api/" + authMode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: pass })
    }).then(function (r) { return r.json(); }).then(function (d) {
      $("auth-submit").disabled = false;
      setAuthMode(authMode);
      if (!d.ok) { $("auth-err").textContent = d.err || "操作失败"; return; }
      authModal.hidden = true;
      loadStore(function () {
        renderFavGroup(); updateBadges(); updateUserChip();
        applyHighlights(currentSlug);
        toast(d.user.email + (authMode === "register" ? " 注册成功，已自动登录" : " 欢迎回来"));
        markAuthSeen();
        if (authMode === "login" && FAI.fav.length + FAI.notes.length > 0) {
          toast("已同步云端数据（收藏 " + FAI.fav.length + " · 标注 " + FAI.notes.length + "）");
        }
      });
    }).catch(function () {
      $("auth-submit").disabled = false;
      setAuthMode(authMode);
      $("auth-err").textContent = "网络错误";
    });
  });
  function updateUserChip() {
    var chip = $("btn-user");
    if (!chip) return;
    if (FAI.user) {
      chip.querySelector(".avatar").textContent = FAI.user.email.slice(0, 1).toUpperCase();
      chip.querySelector(".uc-text").textContent = FAI.user.email.split("@")[0];
      chip.classList.toggle("is-admin", !!FAI.user.is_admin);
      chip.title = FAI.user.email + (FAI.user.is_admin ? "（管理员）" : "");
    } else {
      chip.querySelector(".avatar").innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      chip.querySelector(".avatar").classList.add("guest");
      chip.querySelector(".uc-text").textContent = "登录 / 注册";
      chip.classList.remove("is-admin");
      chip.title = "登录或注册账号（数据云端隔离）";
    }
    var av = chip.querySelector(".avatar");
    if (FAI.user) { av.classList.remove("guest"); }
  }
  var userMenu = null;
  $("btn-user").addEventListener("click", function (e) {
    if (userMenu && document.body.contains(userMenu)) { userMenu.remove(); userMenu = null; return; }
    if (!FAI.ready) { toast("正在检查登录状态…"); return; }
    userMenu = el("div", "auth-menu");
    if (FAI.user) {
      userMenu.innerHTML = '<div class="am-email">' + esc(FAI.user.email) + (FAI.user.is_admin ? ' <span class="admin-badge">管理员</span>' : "") + "</div>";
      var logoutBtn = el("button", null, "退出登录");
      logoutBtn.addEventListener("click", function () {
        fetch("/api/logout", { method: "POST" }).then(function () {
          clearLocalData();
          FAI.fav = []; FAI.notes = []; FAI.bookmark = null;
          FAI.user = null;
          updateUserChip();
          renderFavGroup();
          updateBadges();
          if (currentSlug) applyHighlights(currentSlug);
          renderMarginNotes();
          toast("已退出登录");
          userMenu.remove(); userMenu = null;
        });
      });
      userMenu.appendChild(logoutBtn);
      if (FAI.user.is_admin) {
        var adminBtn = el("button", null, "管理面板");
        adminBtn.addEventListener("click", function () { openAdminPanel(); userMenu.remove(); userMenu = null; });
        userMenu.insertBefore(adminBtn, logoutBtn);
      }
    } else {
      var loginBtn = el("button", null, "登录");
      loginBtn.addEventListener("click", function () { setAuthMode("login"); authModal.hidden = false; setTimeout(function () { $("auth-email").focus(); }, 30); userMenu.remove(); userMenu = null; });
      var regBtn = el("button", null, "注册新账号");
      regBtn.addEventListener("click", function () { setAuthMode("register"); authModal.hidden = false; setTimeout(function () { $("auth-email").focus(); }, 30); userMenu.remove(); userMenu = null; });
      userMenu.appendChild(loginBtn);
      userMenu.appendChild(regBtn);
    }
    $("btn-user").parentElement.style.position = "relative";
    $("btn-user").parentElement.appendChild(userMenu);
    e.stopPropagation();
  });
  document.addEventListener("click", function (e) {
    if (userMenu && !e.target.closest(".auth-menu") && !e.target.closest("#btn-user")) {
      userMenu.remove(); userMenu = null;
    }
  });

  /* ================= 管理员面板 ================= */
  var adminModal = el("div", "note-modal");
  adminModal.id = "admin-modal";
  adminModal.hidden = true;
  adminModal.innerHTML =
    '<div class="note-backdrop" data-close></div>' +
    '<div class="note-card wide" role="dialog" aria-modal="true">' +
    '<div class="note-head">用户管理 <button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div>' +
    '<div style="padding: var(--s-4); overflow:auto;"><div id="admin-body">加载中…</div></div></div>';
  document.body.appendChild(adminModal);
  adminModal.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () { adminModal.hidden = true; });
  });
  function openAdminPanel() {
    adminModal.hidden = false;
    var load = function () {
      fetch("/api/admin/stats").then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { $("admin-body").textContent = d.err || "加载失败"; return; }
        var myEmail = FAI.user ? FAI.user.email : "";
        var myRow = d.users.find(function (u) { return u.email === myEmail; });
        var html = '<div class="admin-stats">' +
          '<div class="admin-stat"><b>' + d.total_users + "</b><span>注册用户总数（全站）</span></div>" +
          '<div class="admin-stat"><b>' + d.total_notes + "</b><span>标注总数（全站所有用户合计）</span></div>" +
          '<div class="admin-stat"><b>' + (myRow ? myRow.notes : 0) + "</b><span>当前账号（" + esc((myEmail.split("@")[0] || "")) + "）的标注</span></div>" +
          "</div>";
        html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
          "<th>ID</th><th>邮箱</th><th>角色</th><th>注册 IP</th><th>注册地</th><th>注册时间</th><th>标注数</th><th>管理</th>" +
          "</tr></thead><tbody>";
        d.users.forEach(function (u) {
          html += "<tr><td>" + u.id + "</td><td>" + esc(u.email) + "</td><td>" +
            (u.is_admin ? '<span class="admin-badge">管理员</span>' : "用户") + "</td><td>" +
            esc(u.reg_ip || "-") + "</td><td>" + esc(u.reg_loc || "-") + "</td><td>" +
            esc(u.created_at || "-") + "</td><td>" + (u.notes || 0) + "</td><td>";
          if (u.is_admin) {
            html += '<span class="adm-na">—</span>';
          } else {
            html += '<span class="adm-ops">' +
              '<button type="button" class="adm-btn" data-op="clear" data-id="' + u.id + '" data-email="' + esc(u.email) + '">清空数据</button>' +
              '<button type="button" class="adm-btn" data-op="reset" data-id="' + u.id + '" data-email="' + esc(u.email) + '">重置密码</button>' +
              '<button type="button" class="adm-btn danger" data-op="del" data-id="' + u.id + '" data-email="' + esc(u.email) + '">删除</button>' +
              "</span>";
          }
          html += "</td></tr>";
        });
        html += "</tbody></table></div>";
        $("admin-body").innerHTML = html;
        $("admin-body").querySelectorAll(".adm-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var op = btn.dataset.op, id = btn.dataset.id, email = btn.dataset.email;
            if (op === "del") {
              if (!confirm("确定删除用户 " + email + " 吗？\n其云端收藏/标注/书签将一并删除，且不可恢复。")) return;
              fetch("/api/admin/users/" + id, { method: "DELETE" }).then(function (r) { return r.json(); }).then(function (res) {
                toast(res.ok ? "已删除用户 " + email : (res.err || "删除失败"));
                if (res.ok) load();
              });
            } else if (op === "clear") {
              if (!confirm("确定清空用户 " + email + " 的云端数据（收藏/标注/书签）吗？")) return;
              fetch("/api/admin/users/" + id + "/clear_data", { method: "POST" }).then(function (r) { return r.json(); }).then(function (res) {
                toast(res.ok ? "已清空该用户数据" : (res.err || "操作失败"));
                if (res.ok) load();
              });
            } else if (op === "reset") {
              var pass = prompt("为 " + email + " 设置新密码（至少 6 位）：", "");
              if (pass === null) return;
              fetch("/api/admin/users/" + id + "/reset_pass", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pass: pass }),
              }).then(function (r) { return r.json(); }).then(function (res) {
                toast(res.ok ? "密码已重置" : (res.err || "重置失败"));
              });
            }
          });
        });
      });
    };
    load();
  }

  /* ================= 书签（续读） ================= */
  // 持续记录阅读位置快照：点击顶部按钮会先把页面滚回顶部，
  // 因此书签必须取"点击前"的阅读位置，而非点击瞬间
  var lastRead = { slug: null, y: 0, max: 1, t: null };
  window.addEventListener("scroll", function () {
    clearTimeout(lastRead.t);
    lastRead.t = setTimeout(function () {
      var h = document.documentElement;
      lastRead.slug = currentSlug;
      lastRead.y = h.scrollTop || window.scrollY || 0;
      lastRead.max = Math.max(1, h.scrollHeight - h.clientHeight);
    }, 120);
  }, { passive: true });

  function toggleBookmark() {
    if (FAI.bookmark && FAI.bookmark.slug === currentSlug) {
      FAI.bookmark = null;
      persistData("bookmark", null);
      updateBookmarkBtn();
      toast("书签已移除");
      return;
    }
    saveBookmark();
  }
  function saveBookmark() {
    var h = document.documentElement;
    var y = h.scrollTop, max = Math.max(1, h.scrollHeight - h.clientHeight);
    if (lastRead.slug === currentSlug && lastRead.y > y) {
      y = lastRead.y; max = lastRead.max;
    }
    var ratio = Math.max(0, Math.min(1, y / max));
    FAI.bookmark = { slug: currentSlug, ratio: ratio, ts: Date.now() };
    persistData("bookmark", FAI.bookmark);
    var meta = docIndex[currentSlug];
    toast("已加书签：《" + ((meta && meta.title) || "").slice(0, 18) + "》· 右下角丝带可随时回到这里");
    updateBookmarkBtn();
    pulseBmFab();
    var btn = document.getElementById("bookmark-btn");
    if (btn) {
      btn.classList.remove("just-saved");
      void btn.offsetWidth;
      btn.classList.add("just-saved");
    }
  }
  function updateBookmarkBtn() {
    var btn = document.getElementById("bookmark-btn");
    if (!btn) return;
    var on = !!(FAI.bookmark && FAI.bookmark.slug === currentSlug);
    btn.classList.toggle("on", on);
    var path = btn.querySelector("path");
    if (path) path.setAttribute("fill", on ? "currentColor" : "none");
    btn.title = on ? "已加书签 · 再次点击移除" : "加入书签，下次自动续读";
    updateBmFab();
  }

  /* 右下角书签丝带：常驻（有书签时），点击直达书签页并恢复阅读位置 */
  var bmFab = null;
  function ensureBmFab() {
    if (bmFab) return;
    bmFab = el("button", "bm-fab");
    bmFab.type = "button";
    bmFab.setAttribute("aria-label", "回到书签继续阅读");
    bmFab.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
      '<span class="bm-fab-card" aria-hidden="true"></span>';
    bmFab.addEventListener("click", gotoBookmark);
    document.body.appendChild(bmFab);
  }
  function updateBmFab() {
    ensureBmFab();
    var bm = FAI.bookmark;
    var valid = !!(bm && docIndex[bm.slug]);
    bmFab.classList.toggle("show", valid);
    bmFab.disabled = !valid;
    if (!valid) return;
    var meta = docIndex[bm.slug];
    var here = currentSlug === bm.slug;
    bmFab.classList.toggle("here", here);
    bmFab.querySelector(".bm-fab-card").innerHTML =
      '<b>书签</b>《' + esc((meta.title || "").slice(0, 18)) + "》<i>" + (here ? "回到标记处" : "点击继续阅读") + "</i>";
    bmFab.title = "书签：《" + (meta.title || "") + "》";
  }
  function pulseBmFab() {
    ensureBmFab();
    bmFab.classList.remove("just");
    void bmFab.offsetWidth;
    bmFab.classList.add("just");
  }
  function gotoBookmark() {
    var bm = FAI.bookmark;
    if (!bm || !docIndex[bm.slug]) return;
    var same = currentSlug === bm.slug;
    if (!same) location.hash = "#/" + bm.slug;
    var targetY = function () {
      var h = document.documentElement;
      return bm.ratio * Math.max(1, h.scrollHeight - h.clientHeight);
    };
    var tries = 0;
    var tryScroll = function () {
      window.scrollTo(0, targetY());
      if (++tries < 8 && Math.abs(window.scrollY - targetY()) > 4) setTimeout(tryScroll, 400);
    };
    setTimeout(function () {
      tryScroll();
      toast(same ? "已回到书签位置" : "已打开书签页，继续上次阅读");
    }, same ? 60 : 700);
  }

  /* ================= WPS 式侧边批注 ================= */
  function renderMarginNotes() {
    var doc = document.getElementById("doc");
    if (!doc) return;
    doc.querySelectorAll(".margin-note, .note-lines").forEach(function (n) { n.remove(); });
    var list = currentSlug ? notesOf(currentSlug) : [];
    document.body.classList.toggle("notes-on", list.length > 0 && window.innerWidth >= 1366);
    if (!list.length) return;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "note-lines");
    doc.appendChild(svg);
    var docRect = doc.getBoundingClientRect();
    var lastBottom = -Infinity; // 就近堆叠：卡片尽量贴近所选，重叠时才下移
    var pending = [];
    list.forEach(function (n) {
      var mark = doc.querySelector('mark.hl[data-id="' + n.id + '"]');
      var target = mark || doc.querySelector('img.img-noted[data-note-id="' + n.id + '"]');
      if (!target) return;
      var r = target.getBoundingClientRect();
      var relTop = r.top - docRect.top;
      pending.push({ n: n, r: r, relTop: relTop });
    });
    pending.sort(function (a, b) { return a.relTop - b.relTop; });
    pending.forEach(function (item) {
      var n = item.n, r = item.r;
      var noteEl = el("div", "margin-note");
      noteEl.style.setProperty("--hl", n.color || HL_COLORS[0]);
      noteEl.innerHTML =
        '<button class="mn-del" title="删除标注">×</button>' +
        '<span class="mn-quote">' + esc((n.quote || "").slice(0, 26)) + "</span>" +
        '<span class="mn-text">' + esc((n.note || "（无笔记内容）").slice(0, 140)) + "</span>";
      noteEl.addEventListener("click", function (e) {
        if (e.target.classList.contains("mn-del")) {
          saveNotes(notes().filter(function (x) { return x.id !== n.id; }));
          applyHighlights(currentSlug);
          renderMarginNotes();
          toast("标注已删除");
          return;
        }
        openNoteModal({ mode: "edit", type: n.type, slug: n.slug, quote: n.quote, img: n.img, id: n.id, note: n.note, color: n.color });
      });
      doc.appendChild(noteEl);
      // 就近定位：默认与所选同行；与上一张卡片重叠时向下顺延
      var desired = Math.max(0, item.relTop - 8);
      var top = Math.max(desired, lastBottom + 14);
      noteEl.style.top = top + "px";
      lastBottom = top + noteEl.offsetHeight;
      // 曲线牵引：锚点取所选最近边缘中点，S 形贝塞尔绕行至卡片
      var nr = noteEl.getBoundingClientRect();
      var x1 = r.right - docRect.left;
      var y1 = item.relTop + r.height / 2;
      var x2 = nr.left - docRect.left - 2;
      var y2 = top + 14;
      var color = n.color || HL_COLORS[0];
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      var cxEase = Math.max(24, (x2 - x1) * 0.45);
      var d = "M " + x1 + " " + y1 +
              " C " + (x1 + cxEase) + " " + y1 + ", " + (x2 - cxEase) + " " + y2 + ", " + x2 + " " + y2;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-dasharray", "4 3");
      path.setAttribute("opacity", "0.8");
      svg.appendChild(path);
      var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x1);
      dot.setAttribute("cy", y1);
      dot.setAttribute("r", "2.6");
      dot.setAttribute("fill", color);
      svg.appendChild(dot);
    });
    // svg 尺寸
    requestAnimationFrame(function () {
      svg.setAttribute("width", Math.max(doc.offsetWidth, doc.scrollWidth));
      svg.setAttribute("height", Math.max(doc.offsetHeight, doc.scrollHeight));
    });
  }
  var marginRO = null;
  try {
    marginRO = new ResizeObserver(function () {
      clearTimeout(marginRO._t);
      marginRO._t = setTimeout(renderMarginNotes, 200);
    });
  } catch (e) {}
  function observeMargin() {
    var doc = document.getElementById("doc");
    if (doc && marginRO) { marginRO.disconnect(); marginRO.observe(doc); }
  }
  (function restoreMarginState() {
    try { if (localStorage.getItem("gw-margin") === "collapsed") document.body.classList.add("margin-collapsed"); } catch (e) {}
  })();

  /* ================= 收藏 ================= */
  var FAV_KEY = "gw-favs";
  function favs() { return FAI.fav; }
  function saveFavs(list) {
    FAI.fav = list || [];
    persistData("fav", FAI.fav);
    renderFavGroup();
    updateBadges();
  }
  function isFav(slug) {
    return favs().some(function (f) { return f.slug === slug; });
  }
  function toggleFav(slug) {
    var list = favs();
    var meta = docIndex[slug];
    if (!meta) return;
    var i = list.findIndex(function (f) { return f.slug === slug; });
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ slug: slug, title: meta.title, section: meta.section, ts: Date.now() });
    saveFavs(list);
  }
  function renderFavGroup() {
    var box = document.getElementById("fav-group");
    if (!box) return;
    var list = favs();
    var head = box.previousElementSibling;
    if (head && head.classList.contains("toc-fav-head")) {
      head.style.display = list.length ? "" : "none";
    }
    box.style.display = list.length ? "" : "none";
    var html = "";
    if (!list.length) {
      html = "";
    } else {
      html = list.map(function (f) {
        return '<div class="fav-item" data-slug="' + f.slug + '">' +
          '<a class="doc-item' + (f.slug === currentSlug ? " active" : "") + '" href="#/' + f.slug + '">' +
          '<span class="item-text">' + esc(f.title) + "</span></a>" +
          '<button class="fav-del" data-slug="' + f.slug + '" title="取消收藏">×</button></div>';
      }).join("");
    }
    box.innerHTML = html;
    box.querySelectorAll(".fav-del").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        toggleFav(btn.dataset.slug);
      });
    });
  }
  function updateFavStar() {
    var btn = document.getElementById("fav-star");
    if (!btn) return;
    var on = isFav(currentSlug);
    btn.classList.toggle("on", on);
    btn.title = on ? "取消收藏" : "收藏本篇";
  }

  /* ================= 标注笔记（飞书式） ================= */
  var NOTE_KEY = "gw-notes";
  var HL_COLORS = ["#ffe9a8", "#c9ecf7", "#d5f0d0", "#f7d6e8"];
  function notes() { return FAI.notes; }
  function saveNotes(list) {
    FAI.notes = list || [];
    persistData("notes", FAI.notes);
    updateBadges();
    renderMarginNotes();
  }
  function notesOf(slug) {
    return notes().filter(function (n) { return n.slug === slug; });
  }
  function uid() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function updateBadges() {
    var fc = document.getElementById("fav-count"), nc = document.getElementById("note-count");
    if (fc) fc.textContent = favs().length;
    if (nc) nc.textContent = notes().length;
  }

  /* --- 文本定位：quote + 出现序号（Range 精确包裹） --- */
  function textNodesOf(root) {
    var out = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }
  function absOffsetOf(root, container, offset) {
    if (container.nodeType !== 3) {
      var tn = container.textContent;
      return -1; // 元素边界不参与保存路径（选区通常落在文本节点）
    }
    var off = 0;
    for (var tn of textNodesOf(root)) {
      if (tn === container) return off + offset;
      off += tn.textContent.length;
    }
    return -1;
  }
  function occurBefore(root, quote, caretAbs) {
    var full = root.textContent, n = 0, i = 0;
    while ((i = full.indexOf(quote, i)) !== -1 && i < caretAbs) { n++; i += Math.max(1, quote.length); }
    return n;
  }
  function wrapOccurrence(root, quote, occur, id, color) {
    var nodes = textNodesOf(root);
    var full = "";
    var cums = [];
    for (var k = 0; k < nodes.length; k++) {
      cums.push(full.length);
      full += nodes[k].textContent;
    }
    var pos = -1, seen = 0, i = 0;
    while ((i = full.indexOf(quote, i)) !== -1) {
      if (seen === occur) { pos = i; break; }
      seen++; i += Math.max(1, quote.length);
    }
    if (pos < 0) return false;
    var startPos = pos, endPos = pos + quote.length;
    var sn = null, so = 0, en = null, eo = 0;
    for (var k = 0; k < nodes.length; k++) {
      var a = cums[k], b = a + nodes[k].textContent.length;
      if (sn === null && startPos >= a && startPos < b) { sn = nodes[k]; so = startPos - a; }
      if (endPos > a && endPos <= b) { en = nodes[k]; eo = endPos - a; break; }
    }
    if (!sn || !en) return false;
    try {
      var range = document.createRange();
      range.setStart(sn, so);
      range.setEnd(en, eo);
      var mark = el("mark", "hl");
      mark.dataset.id = id;
      mark.style.setProperty("--hl", color || HL_COLORS[0]);
      mark.title = "点击查看标注";
      range.surroundContents(mark);
      return true;
    } catch (e) {
      return false; // 跨元素选区：surroundContents 失败则跳过
    }
  }
  function applyHighlights(slug) {
    var body = document.querySelector(".doc-body");
    if (!body) return;
    // 清理旧状态：解包全部 mark、去掉图片标注标记（保证删除后颜色立即消失）
    body.querySelectorAll("mark.hl").forEach(function (m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    body.querySelectorAll("img.img-noted").forEach(function (img) {
      img.classList.remove("img-noted");
      delete img.dataset.noteId;
    });
    notesOf(slug).forEach(function (n) {
      if (n.type === "text") {
        wrapOccurrence(body, n.quote, n.occur || 0, n.id, n.color);
      } else if (n.type === "image") {
        var img = body.querySelector('img[src$="' + n.img + '"]');
        if (img) {
          img.classList.add("img-noted");
          img.dataset.noteId = n.id;
        }
      }
    });
  }

  /* --- 标注 UI：划词工具条 + 笔记弹框 + 管理面板 --- */
  var selBar = el("div", "sel-bar");
  selBar.innerHTML = '<button type="button" class="sel-btn" id="sel-note">✎ 标注笔记</button>';
  selBar.style.display = "none";
  selBar.addEventListener("mousedown", function (e) { e.preventDefault(); });
  document.body.appendChild(selBar);

  var noteModal = el("div", "note-modal");
  noteModal.id = "note-modal";
  noteModal.hidden = true;
  noteModal.innerHTML =
    '<div class="note-backdrop" data-close></div>' +
    '<div class="note-card" role="dialog" aria-modal="true">' +
    '<div class="note-quote" id="note-quote"></div>' +
    '<div class="note-colors" id="note-colors"></div>' +
    '<textarea id="note-input" placeholder="写下你的笔记、心得…" rows="4"></textarea>' +
    '<div class="note-actions">' +
    '<button type="button" class="btn-danger" id="note-del" hidden>删除标注</button>' +
    '<span class="spacer"></span>' +
    '<button type="button" class="btn-ghost" id="note-cancel">取消</button>' +
    '<button type="button" class="btn-primary" id="note-save">保存</button>' +
    "</div></div>";
  document.body.appendChild(noteModal);

  var notesPanel = el("div", "note-modal notes-panel");
  notesPanel.hidden = true;
  notesPanel.innerHTML =
    '<div class="note-backdrop" data-close></div>' +
    '<div class="note-card wide" role="dialog" aria-modal="true">' +
    '<div class="note-head">我的标注 <button type="button" class="icon-btn" data-close aria-label="关闭">×</button></div>' +
    '<div class="notes-list" id="notes-list"></div></div>';
  document.body.appendChild(notesPanel);

  var editCtx = null; // {mode:'new'|'edit', type, slug, quote, occur, img, id, color}

  function openNoteModal(ctx) {
    editCtx = ctx;
    var q = $("note-quote");
    q.textContent = ctx.type === "image" ? "［图片标注］" + (ctx.quote || "") : ctx.quote;
    $("note-input").value = ctx.note || "";
    $("note-del").hidden = ctx.mode !== "edit";
    var colors = $("note-colors");
    colors.innerHTML = "";
    var cur = ctx.color || HL_COLORS[0];
    HL_COLORS.forEach(function (c) {
      var d = el("button", "dot" + (c === cur ? " on" : ""));
      d.type = "button";
      d.style.background = c;
      d.addEventListener("click", function () {
        cur = c;
        colors.querySelectorAll(".dot").forEach(function (x) { x.classList.remove("on"); });
        d.classList.add("on");
      });
      colors.appendChild(d);
    });
    editCtx.color = cur;
    colors.onclick = function () {};
    colors.dataset.pick = "";
    // 记录当前选择颜色（通过事件委托读取被选中的 dot）
    colors.querySelectorAll(".dot").forEach(function (d) {
      d.addEventListener("click", function () { editCtx.color = d.style.background; });
    });
    noteModal.hidden = false;
    setTimeout(function () { $("note-input").focus(); }, 30);
  }
  function closeNoteModal() { noteModal.hidden = true; editCtx = null; }
  noteModal.querySelector("[data-close]").addEventListener("click", closeNoteModal);
  $("note-cancel").addEventListener("click", closeNoteModal);
  $("note-save").addEventListener("click", function () {
    if (!editCtx) return;
    var text = $("note-input").value.trim();
    if (editCtx.mode === "new") {
      var n = {
        id: uid(), slug: editCtx.slug, type: editCtx.type,
        quote: editCtx.quote || "", note: text, color: editCtx.color, ts: Date.now()
      };
      if (editCtx.type === "text") { n.occur = editCtx.occur; }
      if (editCtx.type === "image") { n.img = editCtx.img; }
      var list = notes(); list.push(n); saveNotes(list);
      if (editCtx.type === "text") {
        wrapOccurrence(document.querySelector(".doc-body"), n.quote, n.occur, n.id, n.color);
      } else {
        var img = document.querySelector('.doc-body img[src$="' + n.img + '"]');
        if (img) { img.classList.add("img-noted"); img.dataset.noteId = n.id; }
      }
      renderMarginNotes();
    } else {
      var list2 = notes();
      var idx = list2.findIndex(function (x) { return x.id === editCtx.id; });
      if (idx >= 0) {
        list2[idx].note = text;
        list2[idx].color = editCtx.color;
        saveNotes(list2);
        applyHighlights(currentSlug);
      }
    }
    closeNoteModal();
  });
  $("note-del").addEventListener("click", function () {
    if (!editCtx) return;
    saveNotes(notes().filter(function (x) { return x.id !== editCtx.id; }));
    closeNoteModal();
    applyHighlights(currentSlug);
    renderMarginNotes();
  });

  /* 划词检测 */
  document.addEventListener("mouseup", function (e) {
    if (noteModal.hidden === false) return;
    var body = document.querySelector(".doc-body");
    if (!body || !body.contains(e.target)) { selBar.style.display = "none"; return; }
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { selBar.style.display = "none"; return; }
      var text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < 1 || text.length > 2000) { selBar.style.display = "none"; return; }
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      var range = sel.getRangeAt(0);
      var abs = absOffsetOf(body, range.startContainer, range.startOffset);
      selBar.style.display = "flex";
      var top = rect.top - 44 + window.scrollY;
      var left = rect.left + rect.width / 2 + window.scrollX - 60;
      selBar.style.top = Math.max(8, top) + "px";
      selBar.style.left = Math.max(8, left) + "px";
      selBar.dataset.quote = text;
      selBar.dataset.abs = abs >= 0 ? abs : 0;
    }, 10);
  });
  $("sel-note").addEventListener("click", function () {
    selBar.style.display = "none";
    var body = document.querySelector(".doc-body");
    var quote = selBar.dataset.quote;
    var abs = parseInt(selBar.dataset.abs || "0", 10);
    if (!body || !quote) return;
    var occur = occurBefore(body, quote, abs);
    // 与已有标注重叠检测：选区终点落在任一已有高亮内部则拒绝
    var marks = body.querySelectorAll("mark.hl");
    var full = body.textContent;
    for (var i = 0; i < marks.length; i++) {
      var mAbs = full.indexOf(marks[i].textContent);
      if (mAbs >= 0 && abs >= mAbs && abs < mAbs + marks[i].textContent.length) {
        alert("选中内容与已有标注重叠，请点击原标注进行编辑");
        return;
      }
    }
    openNoteModal({ mode: "new", type: "text", slug: currentSlug, quote: quote, occur: occur, note: "", color: HL_COLORS[0] });
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  });

  /* 点击已有标注 → 编辑；点击标注图片 → 编辑 */
  document.addEventListener("click", function (e) {
    var mark = e.target.closest ? e.target.closest("mark.hl") : null;
    if (mark) {
      var n = notes().find(function (x) { return x.id === mark.dataset.id; });
      if (n) openNoteModal({ mode: "edit", type: n.type, slug: n.slug, quote: n.quote, img: n.img, id: n.id, note: n.note, color: n.color });
      return;
    }
    var imgn = e.target.closest ? e.target.closest("img.img-noted") : null;
    if (imgn && !e.target.closest(".img-note-btn")) {
      var n2 = notes().find(function (x) { return x.id === imgn.dataset.noteId; });
      if (n2) openNoteModal({ mode: "edit", type: "image", slug: n2.slug, quote: n2.img.split("/").pop(), img: n2.img, id: n2.id, note: n2.note, color: n2.color });
    }
  });

  /* 图片标注按钮（hover 浮现） */
  document.addEventListener("mouseover", function (e) {
    var img = e.target.closest ? e.target.closest(".doc-body .img-card img") : null;
    if (!img || img.parentElement.querySelector(".img-note-btn")) return;
    var btn = el("button", "img-note-btn", "✎ 标注");
    btn.type = "button";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      var src = img.getAttribute("src");
      var tail = src.split("/").pop();
      var existed = notes().find(function (x) { return x.type === "image" && x.slug === currentSlug && x.img.endsWith(tail); });
      if (existed) {
        openNoteModal({ mode: "edit", type: "image", slug: currentSlug, quote: tail, img: existed.img, id: existed.id, note: existed.note, color: existed.color });
      } else {
        openNoteModal({ mode: "new", type: "image", slug: currentSlug, quote: tail, img: src, note: "", color: HL_COLORS[0] });
      }
    });
    img.parentElement.appendChild(btn);
  });

  /* 标注管理面板 */
  function openNotesPanel() {
    var list = notes().slice().sort(function (a, b) { return b.ts - a.ts; });
    var box = $("notes-list");
    if (!list.length) {
      box.innerHTML = '<div class="fav-empty">还没有标注 — 选中正文文字或悬停图片即可添加笔记</div>';
    } else {
      box.innerHTML = list.map(function (n) {
        var doc = docIndex[n.slug] || {};
        return '<div class="note-item" data-id="' + n.id + '">' +
          '<div class="ni-head"><span class="ni-doc">' + esc((doc.title || n.slug).slice(0, 24)) + "</span>" +
          '<span class="ni-type">' + (n.type === "image" ? "图片" : "文字") + "</span>" +
          '<button class="fav-del" data-del="' + n.id + '" title="删除">×</button></div>' +
          '<div class="ni-quote" style="--hl:' + (n.color || HL_COLORS[0]) + '">' + esc((n.quote || "").slice(0, 80)) + "</div>" +
          (n.note ? '<div class="ni-note">' + esc(n.note.slice(0, 200)) + "</div>" : "") +
          "</div>";
      }).join("");
      box.querySelectorAll(".note-item").forEach(function (item) {
        item.addEventListener("click", function (e) {
          if (e.target.dataset.del) return;
          var n = notes().find(function (x) { return x.id === item.dataset.id; });
          if (!n) return;
          notesPanel.hidden = true;
          location.hash = "#/" + n.slug;
          setTimeout(function () {
            var target = document.querySelector('mark.hl[data-id="' + n.id + '"]') ||
              document.querySelector('img.img-noted[data-note-id="' + n.id + '"]');
            if (target) { target.scrollIntoView({ block: "center", behavior: "smooth" }); target.classList.add("flash"); setTimeout(function () { target.classList.remove("flash"); }, 1600); }
          }, 900);
        });
      });
      box.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          saveNotes(notes().filter(function (x) { return x.id !== btn.dataset.del; }));
          applyHighlights(currentSlug);
          openNotesPanel();
        });
      });
    }
    notesPanel.hidden = false;
  }
  notesPanel.querySelector("[data-close]").addEventListener("click", function () { notesPanel.hidden = true; });

  /* 侧栏收藏分组（由 init 在 buildTOC 后注入） */
  function injectFavGroup() {
    if (document.getElementById("fav-group")) return;
    var head = el("div", "toc-fav-head", "我的收藏");
    var box = el("div", "toc-fav");
    box.id = "fav-group";
    var toc = $("toc");
    toc.insertBefore(box, toc.firstChild);
    toc.insertBefore(head, box);
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#sf-notes")) { openNotesPanel(); }
  });

  /* ---------------- 侧栏拖拽调宽 ---------------- */
  (function () {
    var sb = $("sidebar"), resizer = $("sidebar-resizer");
    var MIN = 252;
    var savedW = null;
    try { savedW = parseInt(localStorage.getItem("gw-sidebar-w"), 10); } catch (e) {}
    function maxW() { return Math.min(600, Math.max(MIN, (window.innerWidth || 1200) - 560)); }
    function applyW(w) {
      w = Math.max(MIN, Math.min(w, maxW()));
      sb.style.width = w + "px";
      try { localStorage.setItem("gw-sidebar-w", String(Math.round(w))); } catch (e) {}
    }
    if (savedW && window.innerWidth >= 1024 && !document.body.classList.contains("sb-collapsed")) {
      applyW(savedW);
    }
    if (!resizer || typeof window.PointerEvent === "undefined") return;
    var dragging = false, startX = 0, startW = 0;
    resizer.addEventListener("pointerdown", function (e) {
      if (window.innerWidth < 1024 || e.button !== 0 && e.pointerType === "mouse") return;
      dragging = true; startX = e.clientX;
      startW = sb.getBoundingClientRect().width;
      document.body.classList.add("sb-resizing");
      try { resizer.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    resizer.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      applyW(startW + (e.clientX - startX));
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("sb-resizing");
      window.dispatchEvent(new Event("resize")); // 触发边缘批注重排等
    }
    resizer.addEventListener("pointerup", endDrag);
    resizer.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", function () {
      if (document.body.classList.contains("sb-collapsed")) return;
      var cur = sb.getBoundingClientRect().width;
      if (cur > maxW()) applyW(maxW());
    });
  })();

  /* ---------------- init ---------------- */
  buildTOC();
  injectFavGroup();
  renderHome();
  $("sidebar-foot").innerHTML =
    '<span>格物 · 大模型知识库</span>' +
    '<span class="sf-actions">' +
    '<button type="button" id="sf-fav" title="当前账号的收藏（登录后为云端数据）">收藏 <b id="fav-count">0</b></button>' +
    '<button type="button" id="sf-notes" title="当前账号的标注（登录后为云端数据）">标注 <b id="note-count">0</b></button>' +
    "</span>";
  route();
  updateUserChip();
  loadStore(function () {
    updateUserChip(); // 会话恢复后同步顶部账号状态（否则刷新后仍显示"登录/注册"）
    renderFavGroup();
    updateBadges();
    updateBookmarkBtn();
    updateBmFab(); // 书签常驻右下角丝带，点击直达续读
    authIntro(); // 打开网页即可注册/登录：首次访客自动弹出账号浮层
  });
  function authIntro() {
    if (FAI.user) return;
    try { if (localStorage.getItem("gw-auth-seen")) return; } catch (e) {}
    setTimeout(function () {
      if (FAI.user) return;
      setAuthMode("login");
      authModal.hidden = false;
      markAuthSeen();
      setTimeout(function () { var i = $("auth-email"); if (i) i.focus(); }, 80);
    }, 700);
  }
  window.addEventListener("resize", function () {
    clearTimeout(window.__mr);
    window.__mr = setTimeout(renderMarginNotes, 250);
  });
})();
