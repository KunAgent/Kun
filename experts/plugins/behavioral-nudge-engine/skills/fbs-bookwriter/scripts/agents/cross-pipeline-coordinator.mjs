/**
 * U6: 跨流水线协调机制 (P1)
 * 
 * 功能:
 * - 术语表同步
 * - 上下文同步
 * - 定期协调(每分钟)
 */

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';

/**
 * 跨流水线协调器
 */
export class CrossPipelineCoordinator extends EventEmitter {
  constructor(bookRoot, options = {}) {
    super();
    
    this.bookRoot = bookRoot;
    this.syncInterval = options.syncInterval || 60000; // 默认60秒
    this.isRunning = false;
    this.syncTimer = null;
    this.syncHistory = [];
    
    // 文件路径
    this.glossaryPath = path.join(bookRoot, '.fbs', 'GLOSSARY.md');
    this.contextPath = path.join(bookRoot, '.fbs', 'book-context-brief.md');
    this.glossaryAPath = path.join(bookRoot, '.fbs', 'GLOSSARY-A.md');
    this.glossaryBPath = path.join(bookRoot, '.fbs', 'GLOSSARY-B.md');
    
    console.log(`🔗 [U6-P1] 跨流水线协调器初始化完成`);
    console.log(`   同步间隔: ${this.syncInterval}ms`);
  }

  /**
   * 启动协调
   */
  start() {
    if (this.isRunning) {
      console.warn('⚠️ [U6-P1] 协调器已在运行');
      return;
    }
    
    console.log('\n▶️ [U6-P1] 启动跨流水线协调...');
    
    this.isRunning = true;
    
    // 立即执行一次同步
    this.sync();
    
    // 设置定时同步
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.syncInterval);
    
    console.log(`✅ [U6-P1] 协调器已启动 (间隔: ${this.syncInterval}ms)`);
  }

  /**
   * 停止协调
   */
  stop() {
    if (!this.isRunning) {
      console.warn('⚠️ [U6-P1] 协调器未运行');
      return;
    }
    
    console.log('\n⏹️ [U6-P1] 停止跨流水线协调...');
    
    this.isRunning = false;
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    console.log('✅ [U6-P1] 协调器已停止');
  }

  /**
   * 执行同步
   * @returns {Promise<Object>}
   */
  async sync() {
    console.log('\n🔄 [U6-P1] 执行跨流水线同步...');
    const syncStartTime = Date.now();
    
    try {
      const result = {
        timestamp: Date.now(),
        glossarySync: await this.syncGlossary(),
        contextSync: await this.syncContext(),
        syncDuration: Date.now() - syncStartTime
      };
      
      // 记录同步历史
      this.syncHistory.push(result);
      
      // 限制历史记录数量
      if (this.syncHistory.length > 100) {
        this.syncHistory.shift();
      }
      
      // 触发同步完成事件
      this.emit('sync', result);
      
      console.log(`\n✅ [U6-P1] 同步完成 (${result.syncDuration}ms)`);
      console.log(`   术语表: ${result.glossarySync.success ? '✅' : '❌'}`);
      console.log(`   上下文: ${result.contextSync.success ? '✅' : '❌'}`);
      
      return result;
    } catch (error) {
      console.error('❌ [U6-P1] 同步失败:', error.message);
      
      const errorResult = {
        timestamp: Date.now(),
        success: false,
        error: error.message,
        syncDuration: Date.now() - syncStartTime
      };
      
      this.syncHistory.push(errorResult);
      this.emit('error', error);
      
      return errorResult;
    }
  }

  /**
   * 同步术语表
   * @returns {Promise<Object>}
   */
  async syncGlossary() {
    console.log('📝 [U6-P1] 同步术语表...');
    
    try {
      // 读取各流水线的术语表
      const glossaryA = this.readGlossary(this.glossaryAPath);
      const glossaryB = this.readGlossary(this.glossaryBPath);
      
      // 合并术语表
      const mergedGlossary = this.mergeGlossaries(glossaryA, glossaryB);
      
      // 写入主术语表
      this.writeGlossary(this.glossaryPath, mergedGlossary);
      
      const termCountA = glossaryA ? glossaryA.split('\n').length : 0;
      const termCountB = glossaryB ? glossaryB.split('\n').length : 0;
      const termCountMerged = mergedGlossary.split('\n').length;
      
      console.log(`   流水线A: ${termCountA} 术语`);
      console.log(`   流水线B: ${termCountB} 术语`);
      console.log(`   合并后: ${termCountMerged} 术语`);
      
      return {
        success: true,
        termCount: termCountMerged,
        termCountA,
        termCountB
      };
    } catch (error) {
      console.error('❌ [U6-P1] 术语表同步失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 读取术语表
   * @param {string} filepath - 文件路径
   * @returns {string|null}
   */
  readGlossary(filepath) {
    if (!fs.existsSync(filepath)) {
      return null;
    }
    
    return fs.readFileSync(filepath, 'utf-8');
  }

  /**
   * 写入术语表
   * @param {string} filepath - 文件路径
   * @param {string} content - 内容
   */
  writeGlossary(filepath, content) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, content, 'utf-8');
  }

  /**
   * 合并术语表
   * @param {string} glossaryA - 术语表A
   * @param {string} glossaryB - 术语表B
   * @returns {string}
   */
  mergeGlossaries(glossaryA, glossaryB) {
    const termsA = this.parseGlossary(glossaryA);
    const termsB = this.parseGlossary(glossaryB);
    
    // 合并术语(去重)
    const mergedTerms = new Map([...termsA, ...termsB]);
    
    // 格式化术语表
    let content = '# 术语表\n\n';
    content += `**生成时间**: ${new Date().toISOString()}\n`;
    content += `**合并来源**: 流水线A (${termsA.size}) + 流水线B (${termsB.size})\n\n`;
    content += '---\n\n';
    
    // 按字母排序
    const sortedTerms = Array.from(mergedTerms.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
    
    for (const [term, definition] of sortedTerms) {
      content += `## ${term}\n\n${definition}\n\n`;
    }
    
    return content;
  }

  /**
   * 解析术语表
   * @param {string} content - 术语表内容
   * @returns {Map}
   */
  parseGlossary(content) {
    const terms = new Map();
    
    if (!content) {
      return terms;
    }
    
    // 匹配 ## 术语格式
    const termRegex = /##\s+(.+?)\n\n([\s\S]+?)(?=\n##|$)/g;
    let match;
    
    while ((match = termRegex.exec(content)) !== null) {
      const term = match[1].trim();
      const definition = match[2].trim();
      terms.set(term, definition);
    }
    
    return terms;
  }

  /**
   * 同步上下文
   * @returns {Promise<Object>}
   */
  async syncContext() {
    console.log('📄 [U6-P1] 同步上下文...');
    
    try {
      // 这里可以扩展为从各流水线的上下文中同步
      // 目前简化为检查上下文文件是否存在
      
      const contextExists = fs.existsSync(this.contextPath);
      
      if (!contextExists) {
        console.log('   ⚠️ 上下文文件不存在,跳过同步');
        return {
          success: true,
          action: 'skipped',
          reason: 'context_file_not_exists'
        };
      }
      
      // 读取上下文
      const context = fs.readFileSync(this.contextPath, 'utf-8');
      const contextLines = context.split('\n').length;
      
      console.log(`   上下文行数: ${contextLines}`);
      
      return {
        success: true,
        action: 'verified',
        contextLines
      };
    } catch (error) {
      console.error('❌ [U6-P1] 上下文同步失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取同步历史
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getSyncHistory(limit = 10) {
    return this.syncHistory.slice(-limit);
  }

  /**
   * 获取同步统计
   * @returns {Object}
   */
  getSyncStats() {
    const totalSyncs = this.syncHistory.length;
    const successfulSyncs = this.syncHistory.filter(s => s.glossarySync?.success).length;
    const failedSyncs = totalSyncs - successfulSyncs;
    
    return {
      totalSyncs,
      successfulSyncs,
      failedSyncs,
      successRate: totalSyncs > 0 ? (successfulSyncs / totalSyncs * 100).toFixed(2) + '%' : 'N/A',
      isRunning: this.isRunning
    };
  }

  /**
   * 手动触发同步
   * @returns {Promise<Object>}
   */
  async manualSync() {
    console.log('\n🔄 [U6-P1] 手动触发同步...');
    return this.sync();
  }

  /**
   * 清理
   */
  cleanup() {
    console.log('🧹 [U6-P1] 清理协调器...');
    
    this.stop();
    this.syncHistory = [];
    this.removeAllListeners();
    
    console.log('✅ [U6-P1] 清理完成');
  }
}

// CLI入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const bookRoot = process.argv[2] || process.cwd();
  const syncInterval = parseInt(process.argv[3]) || 60000;
  
  console.log('========================================');
  console.log('U6: 跨流水线协调机制 (P1)');
  console.log('========================================\n');
  
  const coordinator = new CrossPipelineCoordinator(bookRoot, { syncInterval });
  
  // 启动协调器
  coordinator.start();
  
  // 10秒后停止
  setTimeout(async () => {
    console.log('\n📊 [U6-P1] 同步统计:');
    const stats = coordinator.getSyncStats();
    console.log(JSON.stringify(stats, null, 2));
    
    console.log('\n📜 [U6-P1] 同步历史(最近5次):');
    const history = coordinator.getSyncHistory(5);
    history.forEach((h, i) => {
      console.log(`  ${i + 1}. ${new Date(h.timestamp).toLocaleTimeString()} - ${h.glossarySync?.success ? '✅' : '❌'}`);
    });
    
    coordinator.cleanup();
    console.log('\n✅ U6 完成');
    process.exit(0);
  }, 10000);
}

export default CrossPipelineCoordinator;
