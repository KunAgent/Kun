#!/usr/bin/env node

/**
 * 框架选品推荐工具 v2
 *
 * 从历史报价单原始数据中实时计算推荐清单（无预处理依赖）。
 *
 * 核心逻辑：
 *   Step 4 - 砍长尾分类：三级分类下产品数 < --min-products 则整个分类淘汰
 *   Step 5a - 80/20 截断：每个三级分类内按频次降序累计到 --cutoff-pct 停
 *   Step 5b - 频次下限：截断后频次 < --min-freq 的 SPU 再淘汰
 *
 * 筛选参数：
 *   --category <lv3类目>     按三级类目筛选（逗号分隔）
 *   --lv1 <一级类目>         按一级类目筛选（逗号分隔）
 *   --all                    全量推荐
 *   --list-categories        列出所有可用类目
 *   --top <N>                每个类目最多返回前 N 个
 *   --output <format>        json（默认）| table | spu-ids | stats
 *
 * 算法参数（由 AI 按场景决策）：
 *   --min-products <N>       砍长尾分类阈值（默认 3）
 *   --cutoff-pct <0~1>       80/20 截断比例（默认 0.8）
 *   --min-freq <N>           频次下限（默认 30）
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'references', 'stage');
const CSV_FILE = resolve(DATA_DIR, 'frame-raw-data.csv');

// --- CSV 解析 ---

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { values.push(current); current = ''; continue; }
      current += ch;
    }
    values.push(current);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i]?.trim() ?? ''; });
    return obj;
  });
}

function loadData() {
  const content = readFileSync(CSV_FILE, 'utf-8');
  return parseCSV(content);
}

// --- 核心算法 ---

/**
 * Step 4: 砍长尾分类
 */
function pruneSmallCategories(data, minProducts) {
  const catCounts = {};
  for (const row of data) {
    catCounts[row.lv3] = (catCounts[row.lv3] || 0) + 1;
  }
  const prunedCats = Object.entries(catCounts)
    .filter(([, count]) => count < minProducts)
    .map(([cat]) => cat);
  const prunedSet = new Set(prunedCats);
  const result = data.filter(row => !prunedSet.has(row.lv3));
  return { result, prunedCats, prunedCount: prunedCats.length };
}

/**
 * Step 5a: 80/20 截断
 */
function applyCutoff(data, cutoffPct) {
  const groups = {};
  for (const row of data) {
    if (!groups[row.lv3]) groups[row.lv3] = [];
    groups[row.lv3].push(row);
  }
  const result = [];
  for (const [, rows] of Object.entries(groups)) {
    const totalFreq = rows.reduce((sum, r) => sum + Number(r.quotation_cnt), 0);
    let cumFreq = 0;
    for (const row of rows) {
      cumFreq += Number(row.quotation_cnt);
      result.push({ ...row, _cum_pct_in_cat: cumFreq / totalFreq });
      if (cumFreq / totalFreq >= cutoffPct) break;
    }
  }
  return result;
}

/**
 * Step 5b: 频次下限
 */
function applyMinFreq(data, minFreq) {
  return data.filter(row => Number(row.quotation_cnt) >= minFreq);
}

// --- CLI ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    output: 'json', top: 0, all: false, listCategories: false,
    category: '', lv1: '',
    minProducts: 3, cutoffPct: 0.8, minFreq: 30,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--category': opts.category = args[++i] || ''; break;
      case '--lv1': opts.lv1 = args[++i] || ''; break;
      case '--top': opts.top = parseInt(args[++i] || '0', 10); break;
      case '--all': opts.all = true; break;
      case '--list-categories': opts.listCategories = true; break;
      case '--output': opts.output = args[++i] || 'json'; break;
      case '--min-products': opts.minProducts = parseInt(args[++i] || '3', 10); break;
      case '--cutoff-pct': opts.cutoffPct = parseFloat(args[++i] || '0.8'); break;
      case '--min-freq': opts.minFreq = parseInt(args[++i] || '30', 10); break;
    }
  }
  return opts;
}

function filterByScope(data, opts) {
  let filtered = data;
  if (!opts.all) {
    if (opts.category) {
      const cats = opts.category.split(',').map(s => s.trim().toLowerCase());
      filtered = filtered.filter(r => cats.some(c => r.lv3.toLowerCase().includes(c)));
    }
    if (opts.lv1) {
      const lv1s = opts.lv1.split(',').map(s => s.trim().toLowerCase());
      filtered = filtered.filter(r => lv1s.some(l => r.lv1.toLowerCase().includes(l)));
    }
  }
  if (opts.top > 0) {
    const groups = {};
    for (const row of filtered) {
      if (!groups[row.lv3]) groups[row.lv3] = [];
      groups[row.lv3].push(row);
    }
    filtered = [];
    for (const rows of Object.values(groups)) {
      filtered.push(...rows.slice(0, opts.top));
    }
  }
  return filtered;
}

function formatOutput(results, opts, stats) {
  if (opts.output === 'spu-ids') {
    return results.map(r => r.spu_id).join(',');
  }
  if (opts.output === 'stats') {
    return JSON.stringify(stats, null, 2);
  }
  if (opts.output === 'table') {
    const header = '| # | 一级类目 | 三级类目 | SPU ID | 产品名 | 频次 | 类目内排名 | 累计占比 |';
    const sep = '|---|---------|---------|--------|--------|------|-----------|---------|';
    const rows = results.map((r, i) =>
      `| ${i + 1} | ${r.lv1} | ${r.lv3} | ${r.spu_id} | ${r.spu_name} | ${r.quotation_cnt} | ${r.rank_in_category} | ${((r._cum_pct_in_cat || 0) * 100).toFixed(1)}% |`
    );
    return [header, sep, ...rows].join('\n');
  }
  return JSON.stringify({
    params: { min_products: opts.minProducts, cutoff_pct: opts.cutoffPct, min_freq: opts.minFreq },
    stats,
    total: results.length,
    items: results.map(r => ({
      spu_id: Number(r.spu_id),
      spu_name: r.spu_name,
      lv1: r.lv1,
      lv3: r.lv3,
      quotation_cnt: Number(r.quotation_cnt),
      rank_in_category: Number(r.rank_in_category),
      cum_pct_in_cat: Number((r._cum_pct_in_cat || 0).toFixed(4)),
    })),
  }, null, 2);
}

function main() {
  const opts = parseArgs();
  const rawData = loadData();
  const totalRaw = rawData.length;
  const totalCats = new Set(rawData.map(r => r.lv3)).size;

  if (opts.listCategories) {
    const { result: afterPrune } = pruneSmallCategories(rawData, opts.minProducts);
    const afterCutoff = applyCutoff(afterPrune, opts.cutoffPct);
    const final = applyMinFreq(afterCutoff, opts.minFreq);
    const cats = {};
    for (const row of final) {
      if (!cats[row.lv3]) cats[row.lv3] = { lv1: row.lv1, lv3: row.lv3, count: 0 };
      cats[row.lv3].count++;
    }
    const sorted = Object.values(cats).sort((a, b) => b.count - a.count);
    console.log(`算法参数: min_products=${opts.minProducts}, cutoff_pct=${opts.cutoffPct}, min_freq=${opts.minFreq}`);
    console.log(`原始: ${totalRaw} SPU / ${totalCats} 类目 → 筛选后: ${final.length} SPU / ${sorted.length} 类目\n`);
    const header = '| # | 一级类目 | 三级类目 | 推荐SPU数 |';
    const sep = '|---|---------|---------|----------|';
    const rows = sorted.map((c, i) => `| ${i + 1} | ${c.lv1} | ${c.lv3} | ${c.count} |`);
    console.log([header, sep, ...rows].join('\n'));
    return;
  }

  if (!opts.all && !opts.category && !opts.lv1) {
    console.error('错误：请指定 --category / --lv1 / --all 之一');
    process.exit(1);
  }

  // Step 4
  const { result: afterPrune, prunedCount } = pruneSmallCategories(rawData, opts.minProducts);
  // Step 5a
  const afterCutoff = applyCutoff(afterPrune, opts.cutoffPct);
  // Step 5b
  const afterMinFreq = applyMinFreq(afterCutoff, opts.minFreq);
  // 范围筛选
  const results = filterByScope(afterMinFreq, opts);

  const stats = {
    raw_spus: totalRaw,
    raw_categories: totalCats,
    after_prune_categories: totalCats - prunedCount,
    pruned_categories: prunedCount,
    after_cutoff_spus: afterCutoff.length,
    after_min_freq_spus: afterMinFreq.length,
    final_spus: results.length,
    final_categories: new Set(results.map(r => r.lv3)).size,
  };

  if (results.length === 0) {
    console.error(`未找到匹配的推荐数据。筛选: category=${opts.category}, lv1=${opts.lv1}`);
    console.error(`统计: ${JSON.stringify(stats)}`);
    process.exit(1);
  }

  console.log(formatOutput(results, opts, stats));
}

main();
