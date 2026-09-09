#!/usr/bin/env python3
"""Headless visual check: capture pages of the local mirror site."""
import asyncio
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8686"
OUT = "/tmp/site-shots"


async def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    targets = sys.argv[1:] or ["home"]
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        for t in targets:
            if t == "home":
                await page.goto(BASE + "/", wait_until="networkidle")
                await page.wait_for_timeout(600)
                await page.screenshot(path=f"{OUT}/home.png")
            elif t == "dark":
                await page.goto(BASE + "/", wait_until="networkidle")
                await page.evaluate("localStorage.setItem('mirror-theme','dark')")
                await page.reload(wait_until="networkidle")
                await page.wait_for_timeout(600)
                await page.screenshot(path=f"{OUT}/dark.png")
            elif t.startswith("doc:"):
                slug = t[4:]
                await page.goto(f"{BASE}/#/{slug}", wait_until="networkidle")
                await page.wait_for_timeout(900)
                await page.screenshot(path=f"{OUT}/doc.png")
            elif t.startswith("mobile:"):
                slug = t[7:]
                await page.set_viewport_size({"width": 390, "height": 844})
                await page.goto(f"{BASE}/#/{slug}" if slug else BASE + "/", wait_until="networkidle")
                await page.wait_for_timeout(900)
                await page.screenshot(path=f"{OUT}/mobile.png")
            elif t == "search":
                await page.goto(BASE + "/", wait_until="networkidle")
                await page.keyboard.press("Control+k")
                await page.wait_for_timeout(400)
                await page.fill("#search-input", "LoRA")
                await page.wait_for_timeout(1800)
                await page.screenshot(path=f"{OUT}/search.png")
        print("console errors:", errors[:10] if errors else "none")
        await browser.close()


asyncio.run(main())
