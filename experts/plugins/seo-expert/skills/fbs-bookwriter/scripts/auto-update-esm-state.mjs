/**
 * U5: ESM状态自动更新 (P1)
 *
 * 功能:
 * - 扫描磁盘章节文件
 * - 自动统计字数
 * - 更新 `.fbs/esm-state.json`（历史 U5 工件）
 *
 * 注意：权威阶段真值为 `.fbs/esm-state.md`（与 intake / session-exit / runtime-nudge 对齐），
 * 本脚本不替代 esm-state.md。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { parseEsmState } from './workbuddy-session-snapshot.mjs';

/**
 * ESM状态自动更新器
 */
export class ESMStateAutoUpdater {
  constructor(bookRoot) {
    this.bookRoot = bookRoot;
    this.esmStatePath = path.join(bookRoot, '.fbs', 'esm-state.json');
    /** 与 deliverables/ 等实际书稿布局对齐；权威阶段仍以 .fbs/esm-state.md 为准 */
    this.chapterGlobPatterns = ['ch*/**/*.md', 'chapters/**/*.md', 'deliverables/**/*.md'];
  }

  /**
   * 权威阶段：与 session-exit / runtime-nudge 同源（表格优先于 frontmatter）
   */
  readCanonicalStageFromMd() {
    const p = path.join(this.bookRoot, '.fbs', 'esm-state.md');
    if (!fs.existsSync(p)) return null;
    try {
      const esm = parseEsmState(fs.readFileSync(p, 'utf8'));
      return esm.currentStage || null;
    } catch {
      return null;
    }
  }

  /**
   * 自动更新ESM状态
   * @returns {Promise<Object>}
   */
  async update() {
    console.log('\n🔄 [U5-P1] 自动更新ESM状态...');
    console.log(`   书籍根目录: ${this.bookRoot}`);
    
    // 1. 扫描磁盘章节文件
    console.log('\n🔍 [U5-P1] 扫描章节文件...');
    const chapterFiles = await this.scanChapterFiles();
    console.log(`   找到 ${chapterFiles.length} 个章节文件`);
    
    // 2. 统计字数和章节数
    console.log('\n📊 [U5-P1] 统计字数和章节数...');
    const stats = await this.collectStats(chapterFiles);
    console.log(`   完成章节: ${stats.completedChapters}`);
    console.log(`   实际字数: ${stats.actualWordCount.toLocaleString()}字`);
    
    // 3. 读取当前ESM状态
    let currentState = this.loadCurrentState();
    
    // 4. 更新状态
    const newState = this.updateState(currentState, stats);
    
    // 5. 保存新状态
    await this.saveState(newState);
    
    console.log('\n✅ [U5-P1] ESM状态更新完成');
    
    return newState;
  }

  /**
   * 扫描章节文件
   * @returns {Promise<Array>}
   */
  async scanChapterFiles() {
    try {
      const seen = new Set();
      const out = [];
      for (const pattern of this.chapterGlobPatterns) {
        const files = await glob(pattern, { cwd: this.bookRoot, absolute: false });
        for (const file of files) {
          if (seen.has(file)) continue;
          seen.add(file);
          out.push(file);
        }
      }
      // 过滤掉隐藏文件和临时文件
      return out.filter(
        (file) => !file.startsWith('.') && !file.includes('.tmp') && !file.includes('~'),
      );
    } catch (error) {
      console.error('❌ [U5-P1] 扫描章节文件失败:', error.message);
      return [];
    }
  }

  /**
   * 收集统计信息
   * @param {Array} chapterFiles - 章节文件列表
   * @returns {Promise<Object>}
   */
  async collectStats(chapterFiles) {
    let actualWordCount = 0;
    const chapterStats = [];
    
    for (const file of chapterFiles) {
      const filepath = path.join(this.bookRoot, file);
      const content = fs.readFileSync(filepath, 'utf-8');
      
      // 统计中文字数
      const wordCount = this.countChineseCharacters(content);
      actualWordCount += wordCount;
      
      // 提取章节号
      const chapterNumber = this.extractChapterNumber(file);
      
      chapterStats.push({
        file,
        chapterNumber,
        wordCount,
        lastModified: fs.statSync(filepath).mtime
      });
    }
    
    return {
      completedChapters: chapterStats.length,
      actualWordCount,
      chapterStats
    };
  }

  /**
   * 统计中文字数
   * @param {string} content - 文本内容
   * @returns {number}
   */
  countChineseCharacters(content) {
    // 统计中文字符(包括标点)
    const chineseRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g;
    const matches = content.match(chineseRegex);
    return matches ? matches.length : 0;
  }

  /**
   * 提取章节号
   * @param {string} filepath - 文件路径
   * @returns {number|null}
   */
  extractChapterNumber(filepath) {
    const match = filepath.match(/ch(\d+)/i);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * 加载当前ESM状态
   * @returns {Object}
   */
  loadCurrentState() {
    if (!fs.existsSync(this.esmStatePath)) {
      console.log('📄 [U5-P1] ESM状态文件不存在,创建初始状态');
      return this.createInitialState();
    }
    
    try {
      const content = fs.readFileSync(this.esmStatePath, 'utf-8');
      const state = JSON.parse(content);
      console.log('📄 [U5-P1] 读取当前ESM状态');
      return state;
    } catch (error) {
      console.error('❌ [U5-P1] 读取ESM状态失败:', error.message);
      return this.createInitialState();
    }
  }

  /**
   * 创建初始状态
   * @returns {Object}
   */
  createInitialState() {
    const stage = this.readCanonicalStageFromMd();
    return {
      version: 'U5-P1-v1.1',
      currentState: stage || 'S0',
      canonicalPhaseFile: '.fbs/esm-state.md',
      note: 'legacy JSON for U5；阶段真值以 esm-state.md 为准，本字段每次更新会与 MD 对齐',
      timestamp: Date.now(),
      completedChapters: 0,
      actualWordCount: 0,
      chapterStats: [],
      transitions: []
    };
  }

  /**
   * 更新状态
   * @param {Object} currentState - 当前状态
   * @param {Object} stats - 统计信息
   * @returns {Object}
   */
  updateState(currentState, stats) {
    const stageFromMd = this.readCanonicalStageFromMd();
    const newState = {
      ...currentState,
      timestamp: Date.now(),
      currentState: stageFromMd || currentState.currentState || 'S0',
      completedChapters: stats.completedChapters,
      actualWordCount: stats.actualWordCount,
      chapterStats: stats.chapterStats,
      lastUpdatedAt: new Date().toISOString()
    };
    
    // 记录状态转换
    const transition = {
      from: currentState.currentState,
      to: 'UPDATED',
      timestamp: Date.now(),
      reason: 'auto_update',
      changes: {
        completedChapters: {
          before: currentState.completedChapters,
          after: stats.completedChapters,
          delta: stats.completedChapters - currentState.completedChapters
        },
        actualWordCount: {
          before: currentState.actualWordCount,
          after: stats.actualWordCount,
          delta: stats.actualWordCount - currentState.actualWordCount
        }
      }
    };
    
    if (!newState.transitions) {
      newState.transitions = [];
    }
    newState.transitions.push(transition);
    
    console.log('\n📊 [U5-P1] 状态变更:');
    console.log(`   完成章节: ${currentState.completedChapters} → ${stats.completedChapters}`);
    console.log(`   实际字数: ${currentState.actualWordCount.toLocaleString()} → ${stats.actualWordCount.toLocaleString()}`);
    
    return newState;
  }

  /**
   * 保存状态
   * @param {Object} state - 状态对象
   * @returns {Promise<void>}
   */
  async saveState(state) {
    const stateContent = JSON.stringify(state, null, 2);
    fs.writeFileSync(this.esmStatePath, stateContent, 'utf-8');
    console.log(`\n💾 [U5-P1] ESM状态已保存: ${this.esmStatePath}`);
  }

  /**
   * 获取当前状态
   * @returns {Object|null}
   */
  getState() {
    if (!fs.existsSync(this.esmStatePath)) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(this.esmStatePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('❌ [U5-P1] 读取ESM状态失败:', error.message);
      return null;
    }
  }

  /**
   * 验证状态完整性
   * @returns {boolean}
   */
  validateState() {
    const state = this.getState();
    
    if (!state) {
      console.warn('⚠️ [U5-P1] ESM状态不存在');
      return false;
    }
    
    // 验证必需字段
    const requiredFields = [
      'version',
      'currentState',
      'timestamp',
      'completedChapters',
      'actualWordCount'
    ];
    
    for (const field of requiredFields) {
      if (!(field in state)) {
        console.error(`❌ [U5-P1] 缺少必需字段: ${field}`);
        return false;
      }
    }
    
    console.log('✅ [U5-P1] ESM状态完整性验证通过');
    return true;
  }

  /**
   * 获取状态摘要
   * @returns {Object}
   */
  getStateSummary() {
    const state = this.getState();
    
    if (!state) {
      return {
        exists: false,
        message: 'ESM状态不存在'
      };
    }
    
    return {
      exists: true,
      version: state.version,
      currentState: state.currentState,
      completedChapters: state.completedChapters,
      actualWordCount: state.actualWordCount,
      lastUpdatedAt: state.lastUpdatedAt,
      transitions: state.transitions?.length || 0
    };
  }
}

/**
 * 快速更新ESM状态
 * @param {string} bookRoot - 书籍根目录
 * @returns {Promise<Object>}
 */
export async function autoUpdateESMState(bookRoot) {
  const updater = new ESMStateAutoUpdater(bookRoot);
  return updater.update();
}

function parseArgs(argv) {
  const o = { bookRoot: null, json: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (!a.startsWith('--') && !o.bookRoot) o.bookRoot = path.resolve(a);
  }
  if (!o.bookRoot) o.bookRoot = process.cwd();
  return o;
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  const args = parseArgs(process.argv);
  const bookRoot = args.bookRoot;

  if (!args.quiet && !args.json) {
    console.log('========================================');
    console.log('U5: ESM状态自动更新 (P1)');
    console.log('========================================\n');
  }

  const updater = new ESMStateAutoUpdater(bookRoot);

  let restoreLog = null;
  if (args.json) {
    const orig = console.log;
    console.log = () => {};
    restoreLog = () => {
      console.log = orig;
    };
  }

  updater
    .update()
    .then((state) => {
      if (restoreLog) restoreLog();
      const summary = updater.getStateSummary();
      const payload = {
        schemaVersion: '1.0.0',
        script: 'auto-update-esm-state.mjs',
        canonicalPhaseFile: '.fbs/esm-state.md',
        legacyJsonFile: '.fbs/esm-state.json',
        bookRoot: path.resolve(bookRoot),
        ok: true,
        state,
        summary,
      };
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log('\n✅ U5 完成');
        console.log('\n状态摘要:');
        console.log(JSON.stringify(summary, null, 2));
      }
      process.exit(0);
    })
    .catch((error) => {
      if (restoreLog) restoreLog();
      const errPayload = {
        schemaVersion: '1.0.0',
        script: 'auto-update-esm-state.mjs',
        ok: false,
        bookRoot: path.resolve(bookRoot),
        error: error instanceof Error ? error.message : String(error),
      };
      if (args.json) {
        console.log(JSON.stringify(errPayload, null, 2));
      } else {
        console.error('\n❌ U5 失败:', error.message);
      }
      process.exit(1);
    });
}

export default ESMStateAutoUpdater;
