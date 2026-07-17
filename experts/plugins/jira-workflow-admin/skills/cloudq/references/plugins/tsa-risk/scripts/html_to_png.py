#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
腾讯云智能顾问 — HTML 报告转 PNG 图片
支持多种截图方案，自动检测可用方案

方案优先级:
    1. Playwright (推荐)
    2. Selenium + Chrome/Chromium
    3. wkhtmltoimage
    4. imgkit

用法:
    python3 html_to_png.py <html_path> [--width 440] [--scale 2]

输出:
    与输入文件同目录下的 .png 文件
"""

import sys
import os
import subprocess
import shutil

# 兼容 Windows 中文环境（GBK 编码无法处理 Unicode 特殊字符）
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def convert_with_playwright(html_path, png_path, width=440, scale=2):
    """使用 Playwright 截图"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  ❌ Playwright 未安装，请手动安装: pip install playwright && python -m playwright install chromium")
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            viewport={'width': width, 'height': 800},
            device_scale_factor=scale
        )
        page.goto(f'file://{os.path.abspath(html_path)}')
        # 等待内容加载
        page.wait_for_load_state('networkidle')
        # 全页面截图
        page.screenshot(path=png_path, full_page=True)
        browser.close()
    return True


def convert_with_selenium(html_path, png_path, width=440, scale=2):
    """使用 Selenium + Chrome 截图"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError:
        print("  ❌ Selenium 未安装，请手动安装: pip install selenium")
        return False

    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument(f'--window-size={width},800')
    options.add_argument(f'--force-device-scale-factor={scale}')

    driver = webdriver.Chrome(options=options)
    driver.get(f'file://{os.path.abspath(html_path)}')

    # 获取页面高度并设置窗口大小
    total_height = driver.execute_script("return document.body.scrollHeight")
    driver.set_window_size(width, total_height)

    import time
    time.sleep(1)

    driver.save_screenshot(png_path)
    driver.quit()
    return True


def convert_with_wkhtmltoimage(html_path, png_path, width=440):
    """使用 wkhtmltoimage 截图"""
    if not shutil.which('wkhtmltoimage'):
        return False

    cmd = [
        'wkhtmltoimage',
        '--width', str(width),
        '--quality', '95',
        '--encoding', 'UTF-8',
        html_path,
        png_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0


def main():
    if len(sys.argv) < 2:
        print("用法: python3 html_to_png.py <html_path> [--width 440] [--scale 2]")
        sys.exit(1)

    html_path = sys.argv[1]

    # 解析可选参数
    width = 440
    scale = 2
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--width' and i + 1 < len(sys.argv):
            width = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--scale' and i + 1 < len(sys.argv):
            scale = int(sys.argv[i + 1])
            i += 2
        else:
            i += 1

    if not os.path.exists(html_path):
        print(f"❌ 文件不存在: {html_path}")
        sys.exit(1)

    # 输出路径
    png_path = os.path.splitext(html_path)[0] + '.png'

    print(f"▶ 输入文件: {html_path}")
    print(f"▶ 输出文件: {png_path}")
    print(f"▶ 视口宽度: {width}px, 缩放: {scale}x")
    print("")

    # 依次尝试各方案
    methods = [
        ('Playwright', lambda: convert_with_playwright(html_path, png_path, width, scale)),
        ('Selenium + Chrome', lambda: convert_with_selenium(html_path, png_path, width, scale)),
        ('wkhtmltoimage', lambda: convert_with_wkhtmltoimage(html_path, png_path, width)),
    ]

    for name, method in methods:
        print(f"▶ 尝试方案: {name}")
        try:
            result = method()
            if result and os.path.exists(png_path):
                file_size = os.path.getsize(png_path)
                print(f"✅ PNG 图片已生成: {png_path}")
                print(f"   文件大小: {file_size / 1024:.1f} KB")
                return
        except Exception as e:
            print(f"  ❌ {name} 失败: {e}")
            continue

    print("")
    print("❌ 所有截图方案均不可用")
    print("")
    print("请安装以下任一工具：")
    print("  方案一（推荐）: pip3 install playwright && python3 -m playwright install chromium")
    print("  方案二: pip3 install selenium  (需要 Chrome/Chromium)")
    print("  方案三: brew install wkhtmltopdf  (macOS)")
    print("")
    print(f"HTML 报告已生成，可直接在浏览器查看: {html_path}")
    sys.exit(1)


if __name__ == '__main__':
    main()
