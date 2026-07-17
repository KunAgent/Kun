#!/usr/bin/env node

/**
 * ensureStraddle + solvePrices 单元测试 & calc-discount 端到端测试。
 * 用法: node scripts/test-discount.mjs
 */

import { ensureStraddle, solvePrices } from './lib/utils.mjs';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertApprox(actual, expected, eps, msg) {
  assert(Math.abs(actual - expected) < eps, `${msg}: expected ${expected}, got ${actual}`);
}

function makeItems(n, hasRates = true) {
  return Array.from({ length: n }, (_, i) => ({
    id: `item_${i}`,
    rates: hasRates ? Array.from({ length: 100 }, (_, j) => Math.min(1, (j + 1) / 100)) : null,
    fallbackDiscountLevel: 50,
  }));
}

function priceRatio(prices) {
  const nonZero = prices.filter((p) => p > 0.001);
  if (nonZero.length < 2) return Infinity;
  return Math.max(...nonZero) / Math.min(...nonZero);
}

function runStraddleThenSolve(levels, minLevels, items, R, T) {
  const B = T / R;
  const adjusted = ensureStraddle(levels, minLevels, items, R);
  const rates = adjusted.map((l) => l / 100);
  const prices = solvePrices(rates, T, B);
  return { levels: adjusted, prices, B };
}

function checkBudget(prices, levels, B, label) {
  const totalBefore = prices.reduce((s, p, i) => s + (levels[i] > 0 ? p / (levels[i] / 100) : 0), 0);
  // 容差来源：finalizePrices 对折后价四舍五入到分，N 项各偏 ≤0.005，
  // 除以 rate 后最大放大 1/0.01=100 倍，取 N*0.5+1 作为绝对容差上限
  const tol = prices.length * 0.5 + 1;
  assertApprox(totalBefore, B, tol, `${label}: 折前价之和 ≈ B(${Math.round(B)})`);
}

// ─── Test 1: 核心 bug — R=0.50 整数档，所有 levels ≤ R ───

console.log('\nTest 1: R=0.50 整数档，L+E 无 H（核心 bug）');
{
  const items = makeItems(5);
  const levels = [38, 38, 41, 50, 41];
  const minLevels = [38, 38, 41, 35, 41];
  const R = 0.50;
  const T = 500000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');
  checkBudget(prices, adj, B, 'Test1');

  const ratio = priceRatio(prices);
  assert(ratio <= 3.1, `价格比 ≤ 3 (actual: ${ratio.toFixed(2)})`);

  const lItems = adj.filter((l) => l / 100 < R - 1e-9);
  assert(lItems.length >= 1, '至少保留 1 个 L 项');
  assert(lItems.every((l) => l <= R * 100), 'L 项 level ≤ R*100');

  console.log(`  levels: [${adj}], ratio: ${ratio.toFixed(2)}`);
}

// ─── Test 2: R 非整数，所有 levels < R ───

console.log('\nTest 2: R=0.375 非整数，所有 levels < R');
{
  const items = makeItems(4);
  const levels = [35, 37, 37, 37];
  const minLevels = [35, 35, 35, 35];
  const R = 0.375;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');
  checkBudget(prices, adj, B, 'Test2');

  const ratio = priceRatio(prices);
  assert(ratio <= 3.1, `价格比 ≤ 3 (actual: ${ratio.toFixed(2)})`);
  assert(adj.some((l) => l / 100 > R + 1e-9), '至少一个 level > R');

  console.log(`  levels: [${adj}], ratio: ${ratio.toFixed(2)}`);
}

// ─── Test 3: 已平衡（L+H 均存在），不应改动 ───

console.log('\nTest 3: 已平衡（L+H），不应改动');
{
  const items = makeItems(3);
  const levels = [38, 50, 55];
  const minLevels = [38, 38, 38];
  const R = 0.50;

  const adj = ensureStraddle(levels, minLevels, items, R);
  assert(adj[0] === 38 && adj[1] === 50 && adj[2] === 55, '输出 === 输入');
}

// ─── Test 4: 全 E（所有 level = R×100），不应改动 ───

console.log('\nTest 4: 全 E（所有 level = R×100）');
{
  const items = makeItems(3);
  const levels = [50, 50, 50];
  const minLevels = [38, 38, 38];
  const R = 0.50;
  const T = 300000;

  const adj = ensureStraddle(levels, minLevels, items, R);
  assert(adj.every((l) => l === 50), '不改动');

  const prices = solvePrices(adj.map((l) => l / 100), T, T / R);
  assertApprox(priceRatio(prices), 1, 0.01, '全 E 均分，ratio = 1');
}

// ─── Test 5: 单产品 ───

console.log('\nTest 5: 单产品');
{
  const items = makeItems(1);
  const levels = [38];
  const minLevels = [38];
  const R = 0.50;

  const adj = ensureStraddle(levels, minLevels, items, R);
  assert(adj[0] === 50, `单产品 → level = R×100 = 50 (actual: ${adj[0]})`);
}

// ─── Test 6: H+E 无 L ───

console.log('\nTest 6: H+E 无 L');
{
  const items = makeItems(3);
  const levels = [50, 55, 60];
  const minLevels = [38, 38, 38];
  const R = 0.50;
  const T = 300000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  assert(adj.some((l) => l / 100 < R - 1e-9), '至少一个 level < R');
  checkBudget(prices, adj, B, 'Test6');

  const ratio = priceRatio(prices);
  assert(ratio <= 3.1, `价格比 ≤ 3 (actual: ${ratio.toFixed(2)})`);

  console.log(`  levels: [${adj}], ratio: ${ratio.toFixed(2)}`);
}

// ─── Test 7: 2 个产品，均在 L ───

console.log('\nTest 7: 2 个产品，均在 L');
{
  const items = makeItems(2);
  const levels = [38, 41];
  const minLevels = [38, 41];
  const R = 0.50;
  const T = 200000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '两个产品都有价格');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');
  checkBudget(prices, adj, B, 'Test7');

  const ratio = priceRatio(prices);
  assert(ratio <= 3.1, `价格比 ≤ 3 (actual: ${ratio.toFixed(2)})`);

  console.log(`  levels: [${adj}], ratio: ${ratio.toFixed(2)}`);
}

// ─── Test 8: 极端情况 — 所有 L 且距离 R 很远 ───

console.log('\nTest 8: 极端 — 所有产品 level=10，R=0.50');
{
  const items = makeItems(4);
  const levels = [10, 10, 10, 10];
  const minLevels = [10, 10, 10, 10];
  const R = 0.50;
  const T = 400000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品有价格');
  checkBudget(prices, adj, B, 'Test8');
  const ratio = priceRatio(prices);
  assert(ratio <= 3.1, `价格比 ≤ 3 (actual: ${ratio.toFixed(2)})`);

  console.log(`  levels: [${adj}], ratio: ${ratio.toFixed(2)}`);
}

// ─── Test 8b: 超极端 — level=1 远离 R，需多个 H 项 ───

console.log('\nTest 8b: 超极端 — level=1, R=0.50，需 k>1');
{
  const items = makeItems(5);
  const levels = [1, 1, 1, 1, 1];
  const minLevels = [1, 1, 1, 1, 1];
  const R = 0.50;
  const T = 500000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品有价格');
  checkBudget(prices, adj, B, 'Test8b');

  // 1/r 约束下 level=1(rate=0.01) 的折前价膨胀 100 倍，物理上无法在 ratio≤3 内
  // 但必须有 L+H 两侧，且折前价之和 = B
  const hCount = adj.filter((l) => l / 100 > R + 1e-9).length;
  assert(hCount >= 1, `H 组应 ≥ 1 个 (actual: ${hCount})`);

  console.log(`  levels: [${adj}], ratio: ${priceRatio(prices).toFixed(2)}, hCount: ${hCount}`);
}

// ─── Test 9: H+E 无 L 且 minLevel 约束阻止推低 ───

console.log('\nTest 9: H+E 无 L，minLevel 限制');
{
  const items = makeItems(3);
  const levels = [50, 55, 60];
  const minLevels = [50, 50, 50]; // 不能推到 49 以下
  const R = 0.50;

  // item 0 minLevel=50, maxLLevel=49 → 不 eligible
  // 无 eligible → 应返回原值（或做最佳近似）
  const adj = ensureStraddle(levels, minLevels, items, R);
  // 因为 minLevels 都 ≥ ceil(R*100)=50 → maxLLevel=49 < 50，无 eligible
  // 函数无法创建 L 组，返回原值
  assert(adj[0] === 50, '无法推低时保持原值');
}

// ─── Test 10: 无表数据（fallback）产品混合 ───

console.log('\nTest 10: 有表 + 无表产品混合');
{
  const items = [
    { id: 'a', rates: Array.from({ length: 100 }, (_, j) => Math.min(1, (j + 1) / 100)), fallbackDiscountLevel: 50 },
    { id: 'b', rates: null, fallbackDiscountLevel: 50 },
    { id: 'c', rates: Array.from({ length: 100 }, (_, j) => Math.min(1, (j + 1) / 100)), fallbackDiscountLevel: 50 },
  ];
  const levels = [38, 50, 41];
  const minLevels = [38, 50, 41];
  const R = 0.50;
  const T = 300000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品有价格');
  checkBudget(prices, adj, B, 'Test10');
  console.log(`  levels: [${adj}], prices: [${prices.map((p) => Math.round(p))}]`);
}

// ─── Test 11: CR 反例 1 — R=0.96 高 R + 全 L + 兜底路径 ───

console.log('\nTest 11: R=0.96 高 R 全 L（CR 反例 1: 兜底不得清空 L 组）');
{
  const items = makeItems(4);
  const levels = [37, 48, 67, 71];
  const minLevels = [37, 10, 17, 67];
  const R = 0.96;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  // 旧版 bug: 全部推到 100 → 综合折扣率偏离目标 0.96
  const hasL = adj.some((l) => l / 100 < R - 1e-9);
  const hasH = adj.some((l) => l / 100 > R + 1e-9);
  assert(hasL, '至少保留 1 个 L 项');
  assert(hasH, '至少创建 1 个 H 项');

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');

  checkBudget(prices, adj, B, 'Test11');

  console.log(`  levels: [${adj}], ratio: ${priceRatio(prices).toFixed(2)}`);
}

// ─── Test 12: CR 反例 2 — R=0.14 低 R + 全 H + 单向 ratio ───

console.log('\nTest 12: R=0.14 低 R 全 H（CR 反例 2: 双向 ratio 控制）');
{
  const items = makeItems(3);
  const levels = [19, 68, 41];
  const minLevels = [1, 48, 12];
  const R = 0.14;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');

  const ratio = priceRatio(prices);
  // 旧版: 6.23。修复后应显著改善（物理约束限制可能仍 > 3）
  assert(ratio < 5, `价格比改善（actual: ${ratio.toFixed(2)}，旧版: 6.23）`);

  checkBudget(prices, adj, B, 'Test12');

  console.log(`  levels: [${adj}], ratio: ${ratio.toFixed(2)}`);
}

// ─── Test 13: 浮点边界 — R=0.55 (R*100 上溢到 55.00000000000001) ───

console.log('\nTest 13: 浮点边界 R=0.55（maxLLevel 浮点上溢）');
{
  const items = makeItems(2);
  const levels = [95, 73];
  const minLevels = [19, 55];
  const R = 0.55;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  // 旧版 bug: adj=[95,73] 不变，综合折扣偏离目标
  assert(adj[0] !== 95 || adj[1] !== 73, 'levels 应有调整，不能保持 [95,73]');
  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');

  checkBudget(prices, adj, B, 'Test13');

  console.log(`  levels: [${adj}]`);
}

// ─── Test 14: 浮点边界 — R=0.56 ───

console.log('\nTest 14: 浮点边界 R=0.56');
{
  const items = makeItems(2);
  const levels = [80, 70];
  const minLevels = [10, 56];
  const R = 0.56;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  checkBudget(prices, adj, B, 'Test14');

  console.log(`  levels: [${adj}]`);
}

// ─── Test 15: 浮点边界 — R=0.28 ───

console.log('\nTest 15: 浮点边界 R=0.28');
{
  const items = makeItems(3);
  const levels = [40, 55, 60];
  const minLevels = [10, 28, 30];
  const R = 0.28;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  checkBudget(prices, adj, B, 'Test15');

  console.log(`  levels: [${adj}]`);
}

// ─── Test 16: H+E 单 H 被 break 卡住（E→H 交换） ───

console.log('\nTest 16: H+E 单 H，E→H 交换');
{
  const items = makeItems(2);
  const levels = [95, 84];
  const minLevels = [57, 84];
  const R = 0.84;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');
  checkBudget(prices, adj, B, 'Test16');
  assert(adj[0] <= 83, `原 H 项推到 L (actual: ${adj[0]})`);
  assert(adj[1] >= 85, `原 E 项提升到 H (actual: ${adj[1]})`);

  console.log(`  levels: [${adj}], ratio: ${priceRatio(prices).toFixed(2)}`);
}

// ─── Test 17: H+E 多 E + 单 H 交换 ───

console.log('\nTest 17: H+E 多 E + 单 H 交换');
{
  const items = makeItems(3);
  const levels = [90, 50, 50];
  const minLevels = [30, 50, 50];
  const R = 0.50;
  const T = 300000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  checkBudget(prices, adj, B, 'Test17');

  console.log(`  levels: [${adj}], ratio: ${priceRatio(prices).toFixed(2)}`);
}

// ─── Test 18: minHLevel 浮点下溢 — R=0.58 ───

console.log('\nTest 18: minHLevel 浮点下溢 R=0.58');
{
  const items = makeItems(2);
  const levels = [58, 59];
  const minLevels = [58, 57];
  const R = 0.58;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  checkBudget(prices, adj, B, 'Test18');

  const hItems = adj.filter((l) => l / 100 > R + 1e-9);
  assert(hItems.length >= 1, `至少 1 个 H 项严格 > R (levels: [${adj}])`);

  console.log(`  levels: [${adj}], ratio: ${priceRatio(prices).toFixed(2)}`);
}

// ─── Test 19: minHLevel 浮点下溢 — R=0.29 ───

console.log('\nTest 19: minHLevel 浮点下溢 R=0.29');
{
  const items = makeItems(3);
  const levels = [25, 29, 35];
  const minLevels = [25, 29, 30];
  const R = 0.29;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(prices.every((p) => p > 0), '所有产品折后价 > 0');
  checkBudget(prices, adj, B, 'Test19');

  const hItems = adj.filter((l) => l / 100 > R + 1e-9);
  assert(hItems.length >= 1, `至少 1 个 H 项严格 > R (levels: [${adj}])`);

  console.log(`  levels: [${adj}], ratio: ${priceRatio(prices).toFixed(2)}`);
}

// ─── Test 20: R=1.0 边界 — 不打折，level 不得超过 100 ───

console.log('\nTest 20: R=1.0 边界（level ≤ 100）');
{
  const items = makeItems(2);
  const levels = [80, 90];
  const minLevels = [80, 90];
  const R = 1.0;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(adj.every((l) => l <= 100), `所有 level ≤ 100 (actual: [${adj}])`);
  assert(prices.every((p) => p > 0), '所有产品有价格');
  assertApprox(prices.reduce((a, b) => a + b, 0), T, 1, '总价 = T');
  checkBudget(prices, adj, B, 'Test20');

  console.log(`  levels: [${adj}], prices: [${prices.map((p) => Math.round(p))}]`);
}

// ─── Test 20b: R=0.995 不应被吸附到 1.0 ───

console.log('\nTest 20b: R=0.995 不应被吸附到 1.0');
{
  const items = makeItems(2);
  const levels = [80, 90];
  const minLevels = [80, 90];
  const R = 0.995;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  // R=0.995 不应被当成 1.0 处理，应正常走 rebalance
  assert(!(adj[0] === 100 && adj[1] === 100), `不应全部推到 100 (actual: [${adj}])`);
  checkBudget(prices, adj, B, 'Test20b');

  console.log(`  levels: [${adj}]`);
}

// ─── Test 21: R=0.01 边界 — 极端低折扣 ───

console.log('\nTest 21: R=0.01 边界（尝试创建 E 组）');
{
  const items = makeItems(2);
  const levels = [2, 2];
  const minLevels = [1, 1];
  const R = 0.01;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  assert(adj.every((l) => l >= 1), `所有 level ≥ 1 (actual: [${adj}])`);
  assert(prices.every((p) => p >= 0), '所有产品价格非负');
  assert(adj.some((l) => l === 1), `至少一个 level=1 (actual: [${adj}])`);
  checkBudget(prices, adj, B, 'Test21');

  console.log(`  levels: [${adj}], prices: [${prices.map((p) => Math.round(p))}]`);
}

// ─── Test 21b: R=0.014 不应被吸附到 0.01 ───

console.log('\nTest 21b: R=0.014 不应被吸附到 0.01');
{
  const items = makeItems(2);
  const levels = [2, 2];
  const minLevels = [1, 1];
  const R = 0.014;
  const T = 100000;

  const { levels: adj, prices, B } = runStraddleThenSolve(levels, minLevels, items, R, T);

  // R=0.014 不应被当成 0.01 处理
  assert(!(adj[0] === 1 && adj[1] === 1), `不应全部推到 1 (actual: [${adj}])`);
  checkBudget(prices, adj, B, 'Test21b');

  console.log(`  levels: [${adj}]`);
}

// ─── 结果汇总 ───

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
