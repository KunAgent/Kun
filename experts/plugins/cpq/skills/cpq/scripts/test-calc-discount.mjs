#!/usr/bin/env node

/**
 * calc-discount.mjs 端到端测试
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvalFirst } from './lib/strategies.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'calc-discount.mjs');

let passed = 0;
let failed = 0;

function run(name, input) {
  const raw = execFileSync('node', [SCRIPT], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 30000,
  });
  return JSON.parse(raw);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function approxEq(a, b, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

// ─── Test cases ───

console.log('\n=== 基础约束验证 ===');

test('fallback 产品 - 四项不同折扣 - 总价和加权平均正确', () => {
  const out = run('basic', {
    totalDiscountedPrice: 375000,
    totalDiscountRate: 0.375,
    tcLevel: 5,
    targetPassRate: 0.7,
    strategy: 'max_joint_prob',
    items: [
      { id: 'r1', fallbackDiscountLevel: 20, productCode: 'x', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
      { id: 'r2', fallbackDiscountLevel: 30, productCode: 'y', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
      { id: 'r3', fallbackDiscountLevel: 40, productCode: 'z', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'prepay' },
      { id: 'r4', fallbackDiscountLevel: 50, productCode: 'w', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'prepay' },
    ],
  });
  assert(out.success, 'should succeed');
  assert(approxEq(out.totalDiscountedPrice, 375000), `sum=${out.totalDiscountedPrice}`);
  assert(approxEq(out.totalDiscountRate, 0.375), `avg=${out.totalDiscountRate}`);
  assert(out.items.every((i) => i.discountedPrice >= 0), 'all prices non-negative');
});

test('单产品 - 所有金额归该产品', () => {
  const out = run('single', {
    totalDiscountedPrice: 100000,
    totalDiscountRate: 0.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'approval_first',
    items: [
      { id: 'only', fallbackDiscountLevel: 50, productCode: 'x', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
    ],
  });
  assert(out.success, 'should succeed');
  assert(out.items.length === 1, 'one item');
  assert(approxEq(out.items[0].discountedPrice, 100000), `price=${out.items[0].discountedPrice}`);
  assert(out.items[0].discountLevel === 50, `level=${out.items[0].discountLevel}`);
});

console.log('\n=== 五种策略测试 ===');

const strategies = ['approval_first', 'even_discount', 'max_joint_prob', 'even_price', 'min_adjust'];
const baseInput = {
  totalDiscountedPrice: 500000,
  totalDiscountRate: 0.4,
  tcLevel: 5,
  targetPassRate: 0.5,
  items: [
    { id: 'a', fallbackDiscountLevel: 20, productCode: 'p1', subProductCode: 's1', billingItemCode: 'b1', subBillingItemCode: 'sb1', saleMode: 'postpay' },
    { id: 'b', fallbackDiscountLevel: 35, productCode: 'p2', subProductCode: 's2', billingItemCode: 'b2', subBillingItemCode: 'sb2', saleMode: 'prepay' },
    { id: 'c', fallbackDiscountLevel: 50, productCode: 'p3', subProductCode: 's3', billingItemCode: 'b3', subBillingItemCode: 'sb3', saleMode: 'postpay' },
  ],
};

for (const strat of strategies) {
  test(`策略 ${strat} - 总价和加权平均正确`, () => {
    const input = { ...baseInput, strategy: strat };
    if (strat === 'min_adjust') {
      input.currentAllocation = [
        { itemId: 'a', discountLevel: 25, discountedPrice: 150000 },
        { itemId: 'b', discountLevel: 40, discountedPrice: 150000 },
        { itemId: 'c', discountLevel: 55, discountedPrice: 200000 },
      ];
    }
    const out = run(strat, input);
    assert(out.success, `${strat} should succeed`);
    assert(approxEq(out.totalDiscountedPrice, 500000), `sum=${out.totalDiscountedPrice}`);
    assert(approxEq(out.totalDiscountRate, 0.4, 0.02), `avg=${out.totalDiscountRate}`);
    assert(out.items.every((i) => i.discountedPrice >= 0), 'non-negative prices');
  });
}

console.log('\n=== 真实表数据测试 ===');

test('表中有数据的产品 - 查表成功且约束满足', () => {
  const out = run('real-data', {
    totalDiscountedPrice: 1000000,
    totalDiscountRate: 0.5,
    tcLevel: 5,
    targetPassRate: 0.5,
    strategy: 'max_joint_prob',
    items: [
      { id: 't1', fallbackDiscountLevel: 30, productCode: 'p_011649', subProductCode: 'sp_011649_eob', billingItemCode: 'v_011649_bs', subBillingItemCode: 'sv_011649_bs_eos', saleMode: 'postpay' },
      { id: 't2', fallbackDiscountLevel: 30, productCode: 'p_011649', subProductCode: 'sp_011649_neg', billingItemCode: 'v_011649_neg', subBillingItemCode: 'sv_011649_neg_pneg', saleMode: 'postpay' },
    ],
  });
  assert(out.success, 'should succeed');
  assert(out.items.some((i) => i._matchedInTable), 'at least one matched');
  assert(approxEq(out.totalDiscountedPrice, 1000000), `sum=${out.totalDiscountedPrice}`);
  assert(approxEq(out.totalDiscountRate, 0.5, 0.02), `avg=${out.totalDiscountRate}`);
});

console.log('\n=== CR 回归：非整数档 R ===');

test('CR-1a: 两产品 R=0.375 加权平均精确等于 0.375', () => {
  const out = run('cr-1a', {
    totalDiscountedPrice: 200000,
    totalDiscountRate: 0.375,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_price',
    items: [
      { id: 'a', fallbackDiscountLevel: 20, productCode: 'x1', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
      { id: 'b', fallbackDiscountLevel: 20, productCode: 'x2', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
    ],
  });
  assert(out.success, 'should succeed');
  assert(approxEq(out.totalDiscountRate, 0.375, 0.001), `加权平均应为 0.375, 实际 ${out.totalDiscountRate}`);
  const levels = out.items.map((i) => i.discountLevel);
  assert(levels.some((l) => l <= 37), `应有产品 <= 37 档, 实际 ${levels}`);
  assert(levels.some((l) => l >= 38), `应有产品 >= 38 档, 实际 ${levels}`);
});

test('CR-1b: 单产品 R=0.375 取最近整数档', () => {
  const out = run('cr-1b', {
    totalDiscountedPrice: 100000,
    totalDiscountRate: 0.375,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_price',
    items: [
      { id: 'only', fallbackDiscountLevel: 20, productCode: 'x', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
    ],
  });
  assert(out.success, 'should succeed');
  assert(out.items[0].discountLevel === 38 || out.items[0].discountLevel === 37,
    `单产品应取 37 或 38 档, 实际 ${out.items[0].discountLevel}`);
});

test('CR-1c: 四产品 R=0.375 各策略加权平均都精确', () => {
  for (const strat of ['approval_first', 'even_discount', 'max_joint_prob', 'even_price']) {
    const out = run(`cr-1c-${strat}`, {
      totalDiscountedPrice: 400000,
      totalDiscountRate: 0.375,
      tcLevel: 5,
      targetPassRate: 0.5,
      strategy: strat,
      items: [
        { id: 'a', fallbackDiscountLevel: 20, productCode: 'x1', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
        { id: 'b', fallbackDiscountLevel: 25, productCode: 'x2', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
        { id: 'c', fallbackDiscountLevel: 30, productCode: 'x3', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
        { id: 'd', fallbackDiscountLevel: 50, productCode: 'x4', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
      ],
    });
    assert(out.success, `${strat} should succeed`);
    assert(approxEq(out.totalDiscountRate, 0.375, 0.002), `${strat}: 加权平均应为 0.375, 实际 ${out.totalDiscountRate}`);
  }
});

console.log('\n=== CR 回归：approval_first max-min 语义 ===');

test('CR-2: approval_first 应真正最大化最差通过率', () => {
  // 复现 CR 的反例：
  // 产品 A: rates=[0.1, 0.9]  → level 1 通过率 0.1, level 2 通过率 0.9
  // 产品 B: rates=[0.1, 0.2]  → level 1 通过率 0.1, level 2 通过率 0.2
  // R=0.5
  // 正确结果: levels=[2,2], 最差通过率 = 0.2
  // 旧 bug 结果: levels=[2,1], 最差通过率 = 0.1

  // 直接测试策略函数
  const items = [
    { id: 'A', rates: [0.1, 0.9], fallbackDiscountLevel: 1 },
    { id: 'B', rates: [0.1, 0.2], fallbackDiscountLevel: 1 },
  ];
  const minLevels = [1, 1]; // targetPassRate 足够低，两个产品的 minLevel 都是 1
  const levels = approvalFirst(items, minLevels, 0.5);

  // 两个产品都应在 level 2（最差通过率 = 0.2）
  const minPassRate = Math.min(items[0].rates[levels[0] - 1], items[1].rates[levels[1] - 1]);
  assert(minPassRate >= 0.2 - 1e-9, `最差通过率应 >= 0.2, 实际 levels=${levels}, minPassRate=${minPassRate}`);
  assert(levels[0] === 2, `产品 A 应在 level 2, 实际 ${levels[0]}`);
  assert(levels[1] === 2, `产品 B 应在 level 2, 实际 ${levels[1]}`);
});

console.log('\n=== 边界情况 ===');

test('不可行 - 所有 minLevel 都大于 R', () => {
  const out = run('infeasible', {
    totalDiscountedPrice: 100000,
    totalDiscountRate: 0.1,
    tcLevel: 3,
    targetPassRate: 0.99,
    strategy: 'approval_first',
    items: [
      { id: 'x', fallbackDiscountLevel: 90, productCode: 'no', subProductCode: 'no', billingItemCode: 'no', subBillingItemCode: 'no', saleMode: 'postpay' },
      { id: 'y', fallbackDiscountLevel: 80, productCode: 'no2', subProductCode: 'no', billingItemCode: 'no', subBillingItemCode: 'no', saleMode: 'postpay' },
    ],
  });
  assert(!out.success, 'should fail');
  assert(out.error.length > 0, 'has error message');
});

test('even_price 策略 - 价格差异小于其他策略', () => {
  const evenOut = run('even-price', {
    totalDiscountedPrice: 600000,
    totalDiscountRate: 0.4,
    tcLevel: 5,
    targetPassRate: 0.5,
    strategy: 'even_price',
    items: [
      { id: 'a', fallbackDiscountLevel: 20, productCode: 'x1', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
      { id: 'b', fallbackDiscountLevel: 30, productCode: 'x2', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
      { id: 'c', fallbackDiscountLevel: 60, productCode: 'x3', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'prepay' },
    ],
  });
  assert(evenOut.success, 'should succeed');
  const prices = evenOut.items.map((i) => i.discountedPrice);
  const maxP = Math.max(...prices);
  const minP = Math.min(...prices);
  const ratio = maxP / (minP || 1);
  // even_price should keep prices relatively close (ratio < 5x)
  assert(ratio < 5, `price ratio ${ratio.toFixed(1)} should be < 5`);
});

console.log('\n=== 输入校验 ===');

test('缺少 items 字段时返回校验错误', () => {
  const out = run('no-items', {
    totalDiscountedPrice: 100000,
    totalDiscountRate: 0.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'approval_first',
    items: [],
  });
  assert(!out.success, 'should fail');
  assert(out.error.includes('校验'), `error should mention validation: ${out.error}`);
});

test('totalDiscountRate 超出范围时返回校验错误', () => {
  const out = run('bad-rate', {
    totalDiscountedPrice: 100000,
    totalDiscountRate: 1.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'approval_first',
    items: [
      { id: 'x', fallbackDiscountLevel: 50, productCode: 'a', subProductCode: 'b', billingItemCode: 'c', subBillingItemCode: 'd', saleMode: 'postpay' },
    ],
  });
  assert(!out.success, 'should fail');
  assert(out.error.includes('校验'), `error should mention validation: ${out.error}`);
});

test('fallbackDiscountLevel 超出范围时返回校验错误', () => {
  const out = run('bad-fallback', {
    totalDiscountedPrice: 100000,
    totalDiscountRate: 0.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'approval_first',
    items: [
      { id: 'x', fallbackDiscountLevel: 0, productCode: 'a', subProductCode: 'b', billingItemCode: 'c', subBillingItemCode: 'd', saleMode: 'postpay' },
    ],
  });
  assert(!out.success, 'should fail');
  assert(out.error.includes('校验'), `error should mention validation: ${out.error}`);
});

console.log('\n=== 三值推导 ===');

const threeValueItems = [
  { id: 'a', fallbackDiscountLevel: 30, productCode: 'x1', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
  { id: 'b', fallbackDiscountLevel: 50, productCode: 'x2', subProductCode: 'a', billingItemCode: 'b', subBillingItemCode: 'c', saleMode: 'postpay' },
];

test('传 totalBudget + totalDiscountRate → 推导 totalDiscountedPrice', () => {
  const out = run('3v-budget-rate', {
    totalBudget: 1000000,
    totalDiscountRate: 0.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_discount',
    items: threeValueItems,
  });
  assert(out.success, 'should succeed');
  assert(approxEq(out.totalDiscountedPrice, 500000), `折后价应为 500000, 实际 ${out.totalDiscountedPrice}`);
});

test('传 totalBudget + totalDiscountedPrice → 推导 totalDiscountRate', () => {
  const out = run('3v-budget-price', {
    totalBudget: 1000000,
    totalDiscountedPrice: 400000,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_discount',
    items: threeValueItems,
  });
  assert(out.success, 'should succeed');
  assert(approxEq(out.totalDiscountRate, 0.4), `折扣率应为 0.4, 实际 ${out.totalDiscountRate}`);
});

test('传 totalDiscountedPrice + totalDiscountRate（原有方式）', () => {
  const out = run('3v-price-rate', {
    totalDiscountedPrice: 500000,
    totalDiscountRate: 0.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_discount',
    items: threeValueItems,
  });
  assert(out.success, 'should succeed');
  assert(approxEq(out.totalDiscountedPrice, 500000), `折后价应为 500000, 实际 ${out.totalDiscountedPrice}`);
});

test('三个都传且一致 → 通过', () => {
  const out = run('3v-all-ok', {
    totalBudget: 1000000,
    totalDiscountRate: 0.5,
    totalDiscountedPrice: 500000,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_discount',
    items: threeValueItems,
  });
  assert(out.success, 'should succeed');
});

test('三个都传但矛盾 → 报错', () => {
  const out = run('3v-all-conflict', {
    totalBudget: 1000000,
    totalDiscountRate: 0.5,
    totalDiscountedPrice: 300000,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_discount',
    items: threeValueItems,
  });
  assert(!out.success, 'should fail');
  assert(out.error.includes('不一致'), `error should mention inconsistency: ${out.error}`);
});

test('只传一个 → 报错', () => {
  const out = run('3v-only-one', {
    totalDiscountRate: 0.5,
    tcLevel: 3,
    targetPassRate: 0.5,
    strategy: 'even_discount',
    items: threeValueItems,
  });
  assert(!out.success, 'should fail');
  assert(out.error.includes('至少'), `error should mention '至少': ${out.error}`);
});

// ─── Summary ───

console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
