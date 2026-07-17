#!/usr/bin/env node
'use strict';

/**
 * GEO诊断报告 HTML 构建脚本
 *
 * 用法: node build-report.js <json-path> [output-path]
 *   json-path   — DiagReport JSON 文件路径（必填）
 *   output-path — 输出 HTML 路径（可选，默认与 JSON 同目录，文件名改为 *-report.html）
 *
 * 退出码:
 *   0 — 成功
 *   1 — JSON 文件不存在或不可读
 *   2 — JSON 解析失败
 *   3 — 模板文件不存在或不可读
 *   4 — 输出写入失败
 */

var fs = require('fs');
var path = require('path');

// ── 解析参数 ──
var args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node build-report.js <json-path> [output-path]');
  process.exit(1);
}

var jsonPath = path.resolve(args[0]);
var outputPath = args[1]
  ? path.resolve(args[1])
  : path.join(path.dirname(jsonPath), path.basename(jsonPath, '.json').replace(/-diag-report$/, '') + '-report.html');

// ── 模板路径（assets 子目录） ──
var templatePath = path.join(__dirname, 'assets', 'geo-diag-renderer.html');

// ── 1. 读取 JSON ──
var jsonRaw;
try {
  jsonRaw = fs.readFileSync(jsonPath, 'utf8');
} catch (e) {
  console.error('❌ JSON 文件不存在或不可读: ' + jsonPath);
  console.error('   ' + e.message);
  process.exit(1);
}

// ── 2. 验证 JSON 合法性 ──
var reportData;
try {
  reportData = JSON.parse(jsonRaw);
} catch (e) {
  // 提取错误位置
  var posMatch = e.message.match(/position\s+(\d+)/i);
  var hint = '';
  if (posMatch) {
    var pos = parseInt(posMatch[1], 10);
    var before = jsonRaw.substring(Math.max(0, pos - 40), pos);
    var after = jsonRaw.substring(pos, pos + 40);
    hint = '\n   位置附近: ...' + before + '⚠️' + after + '...';
  }
  console.error('❌ JSON 解析失败: ' + jsonPath);
  console.error('   ' + e.message + hint);
  process.exit(2);
}

// 基本结构校验
if (!reportData.brand || !reportData.category) {
  console.warn('⚠️ JSON 缺少 brand 或 category 字段，报告可能不完整');
}
if (!reportData.stages || Object.keys(reportData.stages).length === 0) {
  console.warn('⚠️ JSON 缺少 stages 数据，报告将显示"暂无诊断数据"');
}

// ── 3. 读取模板 ──
var template;
try {
  template = fs.readFileSync(templatePath, 'utf8');
} catch (e) {
  console.error('❌ 模板文件不存在或不可读: ' + templatePath);
  console.error('   ' + e.message);
  process.exit(3);
}

// ── 4. 替换占位符 ──
var marker = '<script id="report-data" type="application/json">{}</script>';
var markerIdx = template.indexOf(marker);
if (markerIdx === -1) {
  console.error('❌ 模板中未找到占位符: ' + marker);
  process.exit(3);
}

// 重新序列化 JSON，确保格式合法
var jsonStr = JSON.stringify(reportData, null, 2);
var replacement = '<script id="report-data" type="application/json">' + jsonStr + '</script>';
var finalHtml = template.substring(0, markerIdx) + replacement + template.substring(markerIdx + marker.length);

// ── 5. 写入输出 ──
try {
  fs.writeFileSync(outputPath, finalHtml, 'utf8');
} catch (e) {
  console.error('❌ 输出文件写入失败: ' + outputPath);
  console.error('   ' + e.message);
  process.exit(4);
}

// ── 成功 ──
var sizeKB = (finalHtml.length / 1024).toFixed(1);
var brand = reportData.brand || '?';
var category = reportData.category || '?';
console.log('✅ HTML 报告生成成功');
console.log('   品牌: ' + brand + ' | 类型: ' + category);
console.log('   输出: ' + outputPath);
console.log('   大小: ' + sizeKB + ' KB (' + finalHtml.split('\n').length + ' 行)');
