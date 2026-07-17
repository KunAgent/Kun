#!/usr/bin/env node
/**
 * Darwin Skill - 高清截图脚本
 *
 * 用法: node scripts/screenshot.mjs [html文件路径] [输出png路径]
 *
 * 特性:
 * - 2x deviceScaleFactor，输出高清图
 * - 只截 .card 元素，无多余背景
 * - 等待字体加载完成
 * - 截完自动用 open 命令打开图片
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 使用全局安装的 playwright-core
const pw = require('/Users/alchain/.npm-global/lib/node_modules/playwright/node_modules/playwright-core');

const htmlPath = process.argv[2] || new URL('../templates/result-card.html', import.meta.url).pathname;
const outputPath = process.argv[3] || new URL('../templates/result-card.png', import.meta.url).pathname;

async function screenshot() {
  const browser = await pw.chromium.launch();

  try {
    const context = await browser.newContext({
      viewport: { width: 920, height: 1600 },
      deviceScaleFactor: 2,
    });

    const page = await context.newPage();

    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });

    // 等待字体加载
    await page.evaluate(() => document.fonts.ready);
    // 额外等待确保渲染完成
    await page.waitForTimeout(2000);

    // 只截 .card 元素
    const card = await page.locator('.card');
    await card.screenshot({
      path: outputPath,
      type: 'png',
    });

    console.log(`截图完成: ${outputPath}`);

    // 获取图片尺寸信息
    const box = await card.boundingBox();
    console.log(`卡片尺寸: ${Math.round(box.width)}x${Math.round(box.height)}px (CSS)`);
    console.log(`输出尺寸: ${Math.round(box.width * 2)}x${Math.round(box.height * 2)}px (2x高清)`);

  } finally {
    await browser.close();
  }

  // 自动打开图片
  const { execSync } = require('child_process');
  execSync(`open "${outputPath}"`);
}

screenshot().catch(err => {
  console.error('截图失败:', err.message);
  process.exit(1);
});
