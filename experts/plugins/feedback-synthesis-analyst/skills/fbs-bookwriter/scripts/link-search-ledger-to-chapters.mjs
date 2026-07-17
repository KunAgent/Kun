/**
 * U8: 联网查证台账关联 (P1)
 * 
 * 功能:
 * - 解析search-ledger.jsonl
 * - 关联章节产出
 * - 自动化台账
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

/**
 * 联网查证台账关联器
 */
export class SearchLedgerLinker {
  constructor(bookRoot) {
    this.bookRoot = bookRoot;
    this.ledgerPath = path.join(bookRoot, '.fbs', 'search-ledger.jsonl');
  }

  /**
   * 关联查证台账到章节
   * @returns {Promise<Object>}
   */
  async linkLedgerToChapters() {
    console.log('\n🔗 [U8-P1] 关联查证台账到章节...');
    
    // 1. 读取查证台账
    const ledgerEntries = await this.readLedger();
    console.log(`   读取台账记录: ${ledgerEntries.length} 条`);
    
    // 2. 读取章节文件
    const chapterFiles = await this.scanChapterFiles();
    console.log(`   扫描章节文件: ${chapterFiles.length} 个`);
    
    // 3. 建立关联
    const linkedData = await this.buildLinks(ledgerEntries, chapterFiles);
    console.log(`   建立关联: ${linkedData.links.length} 条`);
    
    // 4. 生成台账报告
    const report = this.generateReport(linkedData);
    
    // 5. 保存关联数据
    await this.saveLinkedData(linkedData);
    
    console.log('\n✅ [U8-P1] 查证台账关联完成');
    
    return report;
  }

  /**
   * 读取查证台账
   * @returns {Promise<Array>}
   */
  async readLedger() {
    if (!fs.existsSync(this.ledgerPath)) {
      console.log('⚠️ [U8-P1] 查证台账不存在');
      return [];
    }
    
    const content = fs.readFileSync(this.ledgerPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    const entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        entries.push(entry);
      } catch (error) {
        console.warn(`⚠️ [U8-P1] 解析台账行失败: ${line.substring(0, 50)}...`);
      }
    }
    
    return entries;
  }

  /**
   * 扫描章节文件
   * @returns {Promise<Array>}
   */
  async scanChapterFiles() {
    const files = await glob('ch*/**/*.md', {
      cwd: this.bookRoot,
      absolute: false
    });
    
    return files.filter(file => 
      !file.startsWith('.') && 
      !file.includes('.tmp')
    );
  }

  /**
   * 建立关联
   * @param {Array} ledgerEntries - 台账条目
   * @param {Array} chapterFiles - 章节文件
   * @returns {Promise<Object>}
   */
  async buildLinks(ledgerEntries, chapterFiles) {
    const links = [];
    const chapterStats = new Map();
    
    // 初始化章节统计
    for (const file of chapterFiles) {
      const chapterNumber = this.extractChapterNumber(file);
      const wordCount = this.countWords(file);
      
      chapterStats.set(file, {
        file,
        chapterNumber,
        wordCount,
        searchCount: 0,
        totalConfidence: 0
      });
    }
    
    // 关联台账条目到章节
    for (const entry of ledgerEntries) {
      const chapter = entry.chapter || this.inferChapter(entry);
      
      if (chapter && chapterStats.has(chapter)) {
        const stats = chapterStats.get(chapter);
        stats.searchCount++;
        stats.totalConfidence += (entry.confidence || 0.5);
        
        links.push({
          ledgerEntry: entry,
          chapterFile: chapter,
          chapterNumber: stats.chapterNumber
        });
      }
    }
    
    // 计算平均置信度
    for (const [file, stats] of chapterStats.entries()) {
      if (stats.searchCount > 0) {
        stats.avgConfidence = stats.totalConfidence / stats.searchCount;
      }
    }
    
    return {
      links,
      chapterStats: Array.from(chapterStats.values())
    };
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
   * 推断章节
   * @param {Object} entry - 台账条目
   * @returns {string|null}
   */
  inferChapter(entry) {
    if (entry.chapter) {
      return entry.chapter;
    }
    
    // 从context或其他字段推断
    if (entry.context) {
      const match = entry.context.match(/ch(\d+)/i);
      if (match) {
        return match[0];
      }
    }
    
    return null;
  }

  /**
   * 统计字数
   * @param {string} filepath - 文件路径
   * @returns {number}
   */
  countWords(filepath) {
    try {
      const content = fs.readFileSync(path.join(this.bookRoot, filepath), 'utf-8');
      const chineseRegex = /[\u4e00-\u9fa5]/g;
      const matches = content.match(chineseRegex);
      return matches ? matches.length : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 生成台账报告
   * @param {Object} linkedData - 关联数据
   * @returns {Object}
   */
  generateReport(linkedData) {
    const totalSearches = linkedData.links.length;
    const totalChapters = linkedData.chapterStats.length;
    
    let totalConfidence = 0;
    let confidenceCount = 0;
    
    for (const stats of linkedData.chapterStats) {
      if (stats.avgConfidence) {
        totalConfidence += stats.avgConfidence;
        confidenceCount++;
      }
    }
    
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;
    
    return {
      totalSearches,
      totalChapters,
      avgSearchesPerChapter: totalChapters > 0 ? (totalSearches / totalChapters).toFixed(2) : 0,
      avgConfidence: avgConfidence.toFixed(2),
      timestamp: Date.now()
    };
  }

  /**
   * 保存关联数据
   * @param {Object} linkedData - 关联数据
   * @returns {Promise<void>}
   */
  async saveLinkedData(linkedData) {
    const outputPath = path.join(this.bookRoot, '.fbs', 'search-ledger-linked.json');
    
    const outputData = {
      version: 'U8-P1-v1.0',
      generatedAt: new Date().toISOString(),
      ...linkedData
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
    
    console.log(`💾 [U8-P1] 关联数据已保存: ${outputPath}`);
  }
}

export default SearchLedgerLinker;
