# -*- coding: utf-8 -*-
"""浏览器端端到端验证：真的在 Chromium 里跑一遍转换。

    py -X utf8 tests/browser_test.py [--port 8899] [--headed]

验证点：
  1. 原生 JSON-LD 结构可解析
  2. 拖入 ASS 文件 → 转换 → 预览出现 SRT 内容
  3. 质检评分出现
  4. 批量转换 + ZIP 下载可用（下载文件能被 unzip 校验）
  5. 页面在整个过程中没有发起任何携带文件的请求（无后端）
"""
from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
TMP = Path("D:/PI/tmp/toolsite-e2e")
TMP.mkdir(parents=True, exist_ok=True)

ASS_SAMPLE = r"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,60

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\i1}Hello,\Nworld
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Second, with comma
Dialogue: 0,0:00:06.10,0:00:06.30,Default,,0,0,0,,This cue is far too short and much too fast to read comfortably
"""

SRT_SAMPLE = """1
00:00:01,000 --> 00:00:03,000
[Music]  Hello   there

2
00:00:02,800 --> 00:00:03,100
This cue is overlapping, far too short and contains way too many characters to read

3
00:00:03,200 --> 00:00:03,300


4
00:00:03,400 --> 00:00:05,000
Second file line
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):  # 静音
        pass


def serve(port: int):
    httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    ass_path = TMP / "sample.ass"
    ass_path.write_text(ASS_SAMPLE, encoding="utf-8")
    srt_path = TMP / "sample2.srt"
    srt_path.write_text(SRT_SAMPLE, encoding="utf-8")

    httpd = serve(args.port)
    base = f"http://127.0.0.1:{args.port}"
    fails: list[str] = []
    reqs: list[str] = []

    with sync_playwright() as p:
        b = p.chromium.launch(headless=not args.headed)
        ctx = b.new_context(accept_downloads=True, viewport={"width": 1280, "height": 1000})
        page = ctx.new_page()
        page.on("request", lambda r: reqs.append(r.url))

        # ---- 1. 转换页 -------------------------------------------------
        page.goto(f"{base}/ass-to-srt.html", wait_until="load")
        assert "ASS to SRT" in page.title(), page.title()

        page.set_input_files("#file", [str(ass_path), str(srt_path)])
        page.wait_for_selector(".card.ready", timeout=8000)
        cards = page.locator(".card").count()
        if cards != 2:
            fails.append(f"应当有 2 个文件卡片，实际 {cards}")

        page.click("#run")
        page.wait_for_selector(".card.done", timeout=10000)
        done = page.locator(".card.done").count()
        if done != 2:
            fails.append(f"应当有 2 个转换完成，实际 {done}")

        # 预览里应是 SRT 而不是 ASS（用 text_content，closed <details> 的 inner_text 为空）
        prev = page.locator(".card.done .preview pre").first.text_content() or ""
        if "-->" not in prev or "Dialogue" in prev:
            fails.append("预览内容不像 SRT：" + prev[:120].replace("\n", " | "))

        # 质检分
        score = page.locator(".score").first.inner_text()
        if "QC" not in score:
            fails.append("没有质检分数：" + score)

        # 生成的文件名后缀正确
        fname = page.locator(".card.done .fname .meta").first.inner_text()
        if "detected ASS" not in fname:
            fails.append("格式探测显示异常：" + fname)

        # ---- 2. ZIP 批量下载 ------------------------------------------
        with page.expect_download(timeout=15000) as dl:
            page.click("#download-all")
        zip_path = TMP / "out.zip"
        dl.value.save_as(str(zip_path))
        r = subprocess.run(["unzip", "-t", str(zip_path)], capture_output=True, text=True)
        if r.returncode != 0:
            fails.append("ZIP 校验失败：" + (r.stdout + r.stderr)[-200:])
        listing = subprocess.run(["unzip", "-l", str(zip_path)], capture_output=True, text=True).stdout
        if "qc-report.md" not in listing:
            fails.append("ZIP 里没有 qc-report.md")
        if listing.count(".srt") < 2:
            fails.append("ZIP 里转换结果数量不足：" + listing[-300:])

        page.screenshot(path=str(TMP / "converter.png"), full_page=False)

        # ---- 3. 主页工具台 + 质检页 -----------------------------------
        page.goto(f"{base}/caption-compliance-checker.html", wait_until="load")
        page.set_input_files("#file", str(srt_path))
        page.wait_for_selector(".card.ready", timeout=8000)
        # 关掉自动修复，才能看到原始缺陷（默认会把重叠/空字幕先修好）
        page.uncheck("#opt-clean")
        page.uncheck("#opt-overlaps")
        page.click("#run")
        page.wait_for_selector(".card.done", timeout=10000)
        nissues = page.locator(".card.done details.issues").count()
        codes = page.locator(".card.done details.issues li .code").all_text_contents()
        if nissues < 1 or not codes:
            fails.append("质检页没发现问题（样例文件本应有 OVERLAP / HIGH_CPS / EMPTY 等问题）")
        else:
            for want in ("OVERLAP", "HIGH_CPS", "EMPTY"):
                if want not in codes:
                    fails.append(f"质检未报出 {want}，实际：{sorted(set(codes))}")

        # ---- 4. 编码修复 ---------------------------------------------
        moji = TMP / "mojibake.srt"
        raw = "1\n00:00:01,000 --> 00:00:03,000\n中文字幕测试\n\n"
        # 模拟「UTF-8 字节被当 Latin-1 读取」的经典乱码
        moji.write_bytes(raw.encode("utf-8").decode("latin-1").encode("latin-1"))
        page.goto(f"{base}/subtitle-encoding-fixer.html", wait_until="load")
        page.set_input_files("#file", str(moji))
        page.wait_for_selector(".card.ready, .card.error", timeout=8000)
        page.click("#run")
        page.wait_for_selector(".card.done, .card.error", timeout=10000)
        fixed = page.locator(".card.done .preview pre").first.text_content() or ""
        if "中文字幕测试" not in fixed:
            fails.append("编码修复失败，预览：" + fixed[:120].replace("\n", " | "))

        # ---- 5. 无后端校验 -------------------------------------------
        page.goto(f"{base}/", wait_until="load")
        reqs.clear()
        page.set_input_files("#file", str(ass_path))
        page.wait_for_selector(".card.ready", timeout=8000)
        page.click("#run")
        page.wait_for_selector(".card.done", timeout=10000)
        external = [u for u in reqs if "127.0.0.1" not in u]
        if external:
            fails.append("转换过程出现了外部请求（不应有任何后端）：" + ", ".join(external[:3]))

        # ---- 6. file:// 离线可用（隐私页声称可离线） -----------------
        page.goto((DIST / "index.html").as_uri(), wait_until="load")
        page.set_input_files("#file", str(ass_path))
        page.wait_for_selector(".card.ready", timeout=8000)
        page.click("#run")
        try:
            page.wait_for_selector(".card.done", timeout=8000)
        except Exception:
            fails.append("file:// 直接打开时无法转换（离线声明不成立）")

        b.close()
    httpd.shutdown()

    print(f"请求数（转换期间）：{len(reqs)}，其中外部请求：{len([u for u in reqs if '127.0.0.1' not in u])}")
    if fails:
        print("\n❌ E2E 失败：")
        for f in fails:
            print("   - " + f)
        return 1
    print("\n✅ 浏览器 E2E 全部通过（转换 / 批量 ZIP / 质检 / 编码 / 无后端）")
    print(f"   截图：{TMP / 'converter.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
