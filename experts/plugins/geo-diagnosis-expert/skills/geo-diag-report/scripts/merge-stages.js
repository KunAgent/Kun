#!/usr/bin/env node
'use strict';

/**
 * GEO诊断报告 - 阶段JSON合并脚本
 *
 * 将分阶段写入的JSON文件合并为完整的诊断报告JSON。
 * 用法: node merge-stages.js <output-dir> <brand> <product> [output-path]
 *   output-dir — 各阶段JSON所在目录（必填）
 *   brand      — 品牌名称（必填）
 *   product    — 产品类型（必填）
 *   output-path — 合并后JSON输出路径（可选，默认 output-dir/<brand><product>-diag-report.json）
 *
 * 阶段文件命名约定：
 *   stage1.json — 阶段1（USER_PROFILE + INFRA_EVAL + COMPETITOR）
 *   stage2.json — 阶段2（AI_SEARCH + GEO_EFFECT + shouluResults）
 *   stage3.json — 阶段3（SENTIMENT）
 *   stage4.json — 阶段4（OVERVIEW + AIVO_SCORE + SUGGESTION）
 *
 * 退出码:
 *   0 — 成功
 *   1 — 参数缺失
 *   2 — 阶段文件缺失
 *   3 — JSON解析失败
 *   4 — 输出写入失败
 */

var fs = require('fs');
var path = require('path');

// ── 解析参数 ──
var args = process.argv.slice(2);
if (args.length < 3) {
  console.error('用法: node merge-stages.js <output-dir> <brand> <product> [output-path]');
  process.exit(1);
}

var outputDir = path.resolve(args[0]);
var brand = args[1];
var product = args[2];
var outputPath = args[3]
  ? path.resolve(args[3])
  : path.join(outputDir, brand + product + '-diag-report.json');

// ── 读取阶段文件 ──
var stageFiles = ['stage1.json', 'stage2.json', 'stage3.json', 'stage4.json'];
var stageData = {};

for (var i = 0; i < stageFiles.length; i++) {
  var filePath = path.join(outputDir, stageFiles[i]);
  if (!fs.existsSync(filePath)) {
    console.error('❌ 阶段文件缺失: ' + filePath);
    process.exit(2);
  }
  try {
    stageData[stageFiles[i]] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log('✅ 已读取: ' + stageFiles[i] + ' (' + Math.round(fs.statSync(filePath).size / 1024) + 'KB)');
  } catch (e) {
    console.error('❌ JSON解析失败: ' + stageFiles[i]);
    console.error('   ' + e.message);
    process.exit(3);
  }
}

// ── 合并逻辑 ──
var s1 = stageData['stage1.json'];
var s2 = stageData['stage2.json'];
var s3 = stageData['stage3.json'];
var s4 = stageData['stage4.json'];

var merged = {
  version: '4.0',
  brand: brand,
  category: product,
  meta: s4.meta || s3.meta || s2.meta || s1.meta || {
    version: '4.0',
    brand: brand,
    product: product
  },
  stages: {}
};

// 阶段1 → USER_PROFILE + INFRA_EVAL + COMPETITOR
if (s1.userProfile) merged.stages.USER_PROFILE = s1.userProfile;
if (s1.infraEval) merged.stages.INFRA_EVAL = s1.infraEval;
if (s1.competitors) merged.stages.COMPETITOR = s1.competitors;

// 阶段2 → AI_SEARCH + GEO_EFFECT（shouluResults嵌入AI_SEARCH）
if (s2.aiSearch) {
  if (s2.shouluResults) {
    s2.aiSearch.shouluResults = s2.shouluResults;
  }
  merged.stages.AI_SEARCH = s2.aiSearch;
}
if (s2.geoEffect) merged.stages.GEO_EFFECT = s2.geoEffect;

// 阶段3 → SENTIMENT
if (s3.sentiment) merged.stages.SENTIMENT = s3.sentiment;

// 阶段4 → OVERVIEW + AIVO_SCORE + SUGGESTION
if (s4.overview) merged.stages.OVERVIEW = s4.overview;
if (s4.aivoScore) merged.stages.AIVO_SCORE = s4.aivoScore;
if (s4.suggestion) merged.stages.SUGGESTION = s4.suggestion;

// 验证9个stageCode完整性
var requiredStages = ['OVERVIEW', 'AIVO_SCORE', 'USER_PROFILE', 'AI_SEARCH', 'INFRA_EVAL', 'COMPETITOR', 'GEO_EFFECT', 'SENTIMENT', 'SUGGESTION'];
var missingStages = [];
for (var j = 0; j < requiredStages.length; j++) {
  if (!merged.stages[requiredStages[j]]) {
    missingStages.push(requiredStages[j]);
  }
}

if (missingStages.length > 0) {
  console.warn('⚠️ 缺失stageCode: ' + missingStages.join(', '));
}

// ── 写入合并JSON ──
try {
  var jsonStr = JSON.stringify(merged, null, 2);
  fs.writeFileSync(outputPath, jsonStr, 'utf8');
  var sizeKB = Math.round(Buffer.byteLength(jsonStr, 'utf8') / 1024);
  console.log('✅ 合并完成: ' + outputPath + ' (' + sizeKB + 'KB)');
  console.log('   包含stageCode: ' + Object.keys(merged.stages).join(', '));
  if (missingStages.length > 0) {
    console.log('   ⚠️ 缺失: ' + missingStages.join(', '));
  }
} catch (e) {
  console.error('❌ 写入失败: ' + e.message);
  process.exit(4);
}

// ── 清理阶段文件 ──
for (var k = 0; k < stageFiles.length; k++) {
  var cleanPath = path.join(outputDir, stageFiles[k]);
  try {
    fs.unlinkSync(cleanPath);
    console.log('🗑️ 已清理: ' + stageFiles[k]);
  } catch (e) {
    // 忽略清理失败
  }
}

process.exit(0);
