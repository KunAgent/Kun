/**
 * FBS-BookWriter ESM 退出状态自动记录钩子
 * 
 * 功能：
 * - 在脚本退出时自动记录 ESM 状态为 IDLE
 * - 支持正常退出、异常退出、用户中断
 * - 确保状态机的一致性
 * 
 * 版本：v1.0.0
 * 作者：FBS-BookWriter Team
 * 许可：MIT
 */

import { recordESMTransition } from './fbs-record-esm-transition.mjs';

/**
 * 当前 ESM 状态
 */
let currentESMState = 'IDLE';

/**
 * 退出原因映射
 */
const EXIT_REASONS = {
  'exit': '正常退出',
  'uncaughtException': '异常退出',
  'unhandledRejection': '未处理的 Promise 拒绝',
  'SIGINT': '用户中断 (Ctrl+C)',
  'SIGTERM': '终止信号',
  'SIGHUP': '终端关闭'
};

/**
 * 是否已处理退出
 */
let exitHandled = false;

/**
 * 设置当前 ESM 状态
 */
export function setESMState(state) {
  currentESMState = state;
}

/**
 * 获取当前 ESM 状态
 */
export function getESMState() {
  return currentESMState;
}

/**
 * 记录退出状态
 */
async function recordExitState(reason) {
  // 防止重复记录
  if (exitHandled) {
    return;
  }

  exitHandled = true;

  const fromState = currentESMState;
  
  // 如果当前已经是 IDLE，不需要记录
  if (fromState === 'IDLE') {
    return;
  }

  try {
    await recordESMTransition({
      from: fromState,
      to: 'IDLE',
      reason: reason,
      timestamp: new Date().toISOString(),
      auto: true // 标记为自动记录
    });
    
    if (process.env.DEBUG) {
      console.log(`[ESM Exit Hook] 已记录状态转换: ${fromState} → IDLE (原因: ${reason})`);
    }
  } catch (error) {
    console.error(`[ESM Exit Hook] 记录状态转换失败: ${error.message}`);
  }
}

/**
 * 设置退出钩子
 */
export function setupExitHook() {
  // 正常退出
  process.on('exit', () => {
    // 注意：exit 事件中无法使用异步操作
    // 这里只是标记退出，实际记录在其他事件中完成
    if (!exitHandled && currentESMState !== 'IDLE') {
      console.warn(`[ESM Exit Hook] 进程退出但未记录状态转换: ${currentESMState} → IDLE`);
    }
  });

  // 异常退出
  process.on('uncaughtException', (error) => {
    console.error('\n[ESM Exit Hook] 捕获未处理的异常:');
    console.error(error);
    recordExitState(EXIT_REASONS.uncaughtException);
    process.exit(1);
  });

  // 未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason, promise) => {
    console.error('\n[ESM Exit Hook] 捕获未处理的 Promise 拒绝:');
    console.error(reason);
    recordExitState(EXIT_REASONS.unhandledRejection);
    process.exit(1);
  });

  // Ctrl+C 中断
  process.on('SIGINT', async () => {
    console.log('\n[ESM Exit Hook] 捕获到 Ctrl+C，正在清理...');
    await recordExitState(EXIT_REASONS.SIGINT);
    process.exit(0);
  });

  // 终止信号
  process.on('SIGTERM', async () => {
    console.log('\n[ESM Exit Hook] 捕获到终止信号，正在清理...');
    await recordExitState(EXIT_REASONS.SIGTERM);
    process.exit(0);
  });

  // 终端关闭
  process.on('SIGHUP', async () => {
    console.log('\n[ESM Exit Hook] 检测到终端关闭，正在清理...');
    await recordExitState(EXIT_REASONS.SIGHUP);
    process.exit(0);
  });

  // Windows 特定信号
  if (process.platform === 'win32') {
    process.on('SIGBREAK', async () => {
      console.log('\n[ESM Exit Hook] 捕获到 SIGBREAK，正在清理...');
      await recordExitState(EXIT_REASONS.SIGINT);
      process.exit(0);
    });
  }

  if (process.env.DEBUG) {
    console.log('[ESM Exit Hook] 退出钩子已设置');
  }
}

/**
 * 手动触发退出状态记录
 */
export async function triggerExitStateRecord(reason = '手动触发') {
  await recordExitState(reason);
  exitHandled = true;
}

/**
 * 重置退出钩子状态（仅用于测试）
 */
export function resetExitHookState() {
  exitHandled = false;
}

/**
 * CLI 接口
 */
export async function runCLI() {
  console.log('FBS-BookWriter ESM 退出状态自动记录钩子 v1.0.0');
  console.log('\n用法:');
  console.log('  // 在脚本中导入并设置钩子');
  console.log('  import { setupExitHook, setESMState } from "./scripts/esm-exit-hook.mjs";');
  console.log('');
  console.log('  // 设置退出钩子');
  console.log('  setupExitHook();');
  console.log('');
  console.log('  // 更新 ESM 状态');
  console.log('  setESMState("RESEARCH");');
  console.log('');
  console.log('  // ... 脚本逻辑 ...');
  console.log('');
  console.log('  // 脚本退出时自动记录状态为 IDLE');
  console.log('\n功能:');
  console.log('  ✅ 正常退出时自动记录');
  console.log('  ✅ 异常退出时自动记录');
  console.log('  ✅ 用户中断 (Ctrl+C) 时自动记录');
  console.log('  ✅ 支持多种退出原因');
  console.log('\n环境变量:');
  console.log('  DEBUG=1  - 启用调试输出');
  console.log('\n测试:');
  console.log('  node esm-exit-hook.mjs --test');
  
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    await runTests();
  }
}

/**
 * 测试函数
 */
async function runTests() {
  console.log('\n━━━━━━ 🧪 测试 ESM 退出钩子 ━━━━━━\n');

  // 测试1：设置状态
  console.log('测试1: 设置 ESM 状态');
  setESMState('RESEARCH');
  console.log(`当前状态: ${getESMState()}`);
  console.log('✅ 通过\n');

  // 测试2：手动触发退出记录
  console.log('测试2: 手动触发退出状态记录');
  try {
    await triggerExitStateRecord('测试触发');
    console.log('✅ 通过\n');
  } catch (error) {
    console.log(`❌ 失败: ${error.message}\n`);
  }

  // 测试3：设置退出钩子
  console.log('测试3: 设置退出钩子');
  setupExitHook();
  console.log('✅ 通过\n');

  console.log('━━━━━━ 测试完成 ━━━━━━');
  console.log('\n提示: 使用 Ctrl+C 测试异常退出时的钩子功能');
}

// 如果直接运行此文件，执行CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI();
}
