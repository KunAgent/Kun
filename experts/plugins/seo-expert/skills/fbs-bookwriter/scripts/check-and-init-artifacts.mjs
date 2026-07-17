/**
 * U1: 虚拟书房初始化强制检查 (P0)
 * 
 * 功能:
 * - 检查虚拟书房三层底座（`.fbs/` / `deliverables/` / `releases/`）与核心基础工件是否存在
 * - 缺失时自动执行 init-fbs-multiagent-artifacts.mjs
 * - 验证虚拟书房初始化结果
 * - 失败时阻断 spawn
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const REQUIRED_BASE_DIRS = [
  '.fbs',
  'deliverables',
  'releases'
];

const REQUIRED_FBS_ARTIFACTS = [
  '.fbs/GLOSSARY.md',
  '.fbs/book-context-brief.md',
  '.fbs/search-ledger.jsonl',
  '.fbs/member-heartbeats.json',
  '.fbs/chapter-dependencies.json',
  '.fbs/task-queue.json',
  '.fbs/rate-budget.json'
];

function getRequiredArtifacts() {
  return [...REQUIRED_BASE_DIRS, ...REQUIRED_FBS_ARTIFACTS];
}


/**
 * 检查并初始化虚拟书房底座
 * @param {string} bookRoot - 书籍根目录
 * @param {string} skillRoot - Skill根目录
 * @returns {Promise<boolean>} 成功返回true
 */
export async function checkAndInitArtifacts(bookRoot, skillRoot) {
  console.log('🔍 [U1-P0] 检查虚拟书房底座...');
  console.log(`   书籍根目录: ${bookRoot}`);
  console.log(`   Skill根目录: ${skillRoot}`);
  
  // 1. 检查虚拟书房三层底座与基础工件
  const missingFiles = [];
  
  for (const artifact of getRequiredArtifacts()) {
    const artifactPath = path.join(bookRoot, artifact);
    if (!fs.existsSync(artifactPath)) {
      missingFiles.push(artifact);
      console.log(`   ❌ 缺失: ${artifact}`);
    } else {
      console.log(`   ✅ 存在: ${artifact}`);
    }
  }

  
  // 3. 如果没有缺失,直接返回
  if (missingFiles.length === 0) {
    console.log('✅ [U1-P0] 虚拟书房底座已就绪');
    return true;
  }
  
  // 4. 有缺失,执行初始化
  console.log(`⚠️ [U1-P0] 虚拟书房缺失 ${missingFiles.length} 个基础工件,正在补齐...`);
  console.log(`   缺失列表: ${missingFiles.join(', ')}`);
  
  try {
    const initScript = path.join(skillRoot, 'scripts', 'init-fbs-multiagent-artifacts.mjs');
    
    if (!fs.existsSync(initScript)) {
      throw new Error(`初始化脚本不存在: ${initScript}`);
    }
    
    console.log(`   执行: node "${initScript}" --book-root "${bookRoot}"`);
    
    const { stdout, stderr } = await execAsync(
      `node "${initScript}" --book-root "${bookRoot}"`,
      { cwd: bookRoot }
    );
    
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    console.log('✅ [U1-P0] 虚拟书房初始化执行完成');
    
    // 5. 验证初始化结果
    const stillMissing = getRequiredArtifacts().filter(file => 
      !fs.existsSync(path.join(bookRoot, file))
    );

    
    if (stillMissing.length > 0) {
      throw new Error(
        `[U1-P0] 虚拟书房初始化失败,仍缺失: ${stillMissing.join(', ')}`
      );
    }
    
    console.log('✅ [U1-P0] 虚拟书房基础工件已全部就绪');
    
    // 6. 输出虚拟书房摘要
    logArtifactSummary(bookRoot);
    
    return true;
  } catch (error) {
    console.error('❌ [U1-P0] 虚拟书房初始化失败:', error.message);
    console.error(error);
    throw error;
  }
}

/**
 * 输出虚拟书房摘要
 * @param {string} bookRoot - 书籍根目录
 */
function logArtifactSummary(bookRoot) {
  console.log('\n📊 [U1-P0] 虚拟书房摘要:');
  
  for (const artifact of REQUIRED_BASE_DIRS) {
    const artifactPath = path.join(bookRoot, artifact);
    if (fs.existsSync(artifactPath) && fs.statSync(artifactPath).isDirectory()) {
      console.log(`   ✅ ${artifact}/ (目录)`);
    } else {
      console.log(`   ❌ ${artifact}/ (不存在)`);
    }
  }

  for (const artifact of REQUIRED_FBS_ARTIFACTS) {
    const artifactPath = path.join(bookRoot, artifact);
    const stats = fs.existsSync(artifactPath)
      ? fs.statSync(artifactPath)
      : null;

    if (stats) {
      const size = stats.size;
      const sizeStr = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
      console.log(`   ✅ ${artifact} (${sizeStr})`);
    } else {
      console.log(`   ❌ ${artifact} (不存在)`);
    }
  }
}


/**
 * 检查单个工件是否存在
 * @param {string} bookRoot - 书籍根目录
 * @param {string} artifact - 工件路径
 * @returns {boolean}
 */
export function checkArtifactExists(bookRoot, artifact) {
  const artifactPath = path.join(bookRoot, artifact);
  return fs.existsSync(artifactPath);
}

/**
 * 获取缺失工件列表
 * @param {string} bookRoot - 书籍根目录
 * @returns {string[]}
 */
export function getMissingArtifacts(bookRoot) {
  return getRequiredArtifacts().filter(file => 
    !checkArtifactExists(bookRoot, file)
  );
}


/**
 * 验证所有工件
 * @param {string} bookRoot - 书籍根目录
 * @returns {boolean}
 */
export function validateAllArtifacts(bookRoot) {
  const missing = getMissingArtifacts(bookRoot);
  if (missing.length > 0) {
    console.error(`[U1-P0] 验证失败,缺失: ${missing.join(', ')}`);
    return false;
  }
  console.log('[U1-P0] 验证成功,虚拟书房基础工件存在');
  return true;
}

// CLI入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const bookRoot = process.argv[2] || process.cwd();
  const skillRoot = process.argv[3] || path.join(process.cwd(), '..');
  
  console.log('========================================');
  console.log('U1: 虚拟书房初始化强制检查 (P0)');
  console.log('========================================\n');
  
  checkAndInitArtifacts(bookRoot, skillRoot)
    .then(() => {
      console.log('\n✅ U1 完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ U1 失败:', error.message);
      process.exit(1);
    });
}

export default checkAndInitArtifacts;
