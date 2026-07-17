/**
 * U4: Chapter Brief强制落盘 (P1)
 * 
 * 功能:
 * - Brief内容格式化
 * - 按章节号命名
 * - 任务描述中引用路径
 */

import fs from 'fs';
import path from 'path';

/**
 * Chapter Brief保存器
 */
export class ChapterBriefSaver {
  constructor(bookRoot) {
    this.bookRoot = bookRoot;
    this.briefsDir = path.join(bookRoot, '.fbs', 'briefs');
    
    // 确保briefs目录存在
    if (!fs.existsSync(this.briefsDir)) {
      fs.mkdirSync(this.briefsDir, { recursive: true });
      console.log(`📁 [U4-P1] 创建briefs目录: ${this.briefsDir}`);
    }
  }

  /**
   * 保存Chapter Brief
   * @param {number} chapterNumber - 章节号
   * @param {string} chapterTitle - 章节标题
   * @param {Object} briefData - Brief数据
   * @returns {Promise<string>} 保存路径
   */
  async save(chapterNumber, chapterTitle, briefData) {
    console.log(`\n📝 [U4-P1] 保存Chapter Brief: Ch${chapterNumber}`);
    
    // 格式化Brief内容
    const formattedBrief = this.formatBrief(chapterNumber, chapterTitle, briefData);
    
    // 生成文件路径
    const filename = `brief-ch${chapterNumber}.md`;
    const filepath = path.join(this.briefsDir, filename);
    
    // 保存文件
    fs.writeFileSync(filepath, formattedBrief, 'utf-8');
    
    console.log(`✅ [U4-P1] Brief已保存: ${filepath}`);
    
    // 返回相对路径(用于任务描述)
    return `.fbs/briefs/${filename}`;
  }

  /**
   * 格式化Brief内容
   * @param {number} chapterNumber - 章节号
   * @param {string} chapterTitle - 章节标题
   * @param {Object} briefData - Brief数据
   * @returns {string}
   */
  formatBrief(chapterNumber, chapterTitle, briefData) {
    const now = new Date().toISOString();
    
    let content = `# Chapter Brief: Ch${chapterNumber} - ${chapterTitle}\n\n`;
    content += `**生成时间**: ${now}\n\n`;
    content += `---\n\n`;
    
    // 章节目标
    if (briefData.objective) {
      content += `## 章节目标\n\n${briefData.objective}\n\n`;
    }
    
    // 子节结构
    if (briefData.sections && briefData.sections.length > 0) {
      content += `## 子节结构\n\n`;
      for (const section of briefData.sections) {
        content += `### ${section.number} ${section.title}\n\n`;
        if (section.description) {
          content += `${section.description}\n\n`;
        }
      }
    }
    
    // 证据需求
    if (briefData.evidence) {
      content += `## 证据需求\n\n`;
      if (Array.isArray(briefData.evidence)) {
        for (const evidence of briefData.evidence) {
          content += `- ${evidence}\n`;
        }
      } else {
        content += `${briefData.evidence}\n`;
      }
      content += `\n`;
    }
    
    // 素材路径
    if (briefData.materials) {
      content += `## 素材路径\n\n`;
      content += `- 素材库: \`.fbs/materials/ch${chapterNumber}/\`\n`;
      if (briefData.materials.length > 0) {
        content += `- 素材文件:\n`;
        for (const material of briefData.materials) {
          content += `  - ${material}\n`;
        }
      }
      content += `\n`;
    }
    
    // 作者声音
    if (briefData.authorVoice) {
      content += `## 作者声音约束\n\n${briefData.authorVoice}\n\n`;
    }
    
    // 写作要求
    if (briefData.writingRequirements) {
      content += `## 写作要求\n\n`;
      if (Array.isArray(briefData.writingRequirements)) {
        for (const requirement of briefData.writingRequirements) {
          content += `- ${requirement}\n`;
        }
      } else {
        content += `${briefData.writingRequirements}\n`;
      }
      content += `\n`;
    }
    
    // 字数要求
    if (briefData.wordCount) {
      content += `## 字数要求\n\n`;
      content += `- 预计字数: ${briefData.wordCount.expected || 'N/A'}\n`;
      content += `- 最小字数: ${briefData.wordCount.min || 'N/A'}\n`;
      content += `- 最大字数: ${briefData.wordCount.max || 'N/A'}\n\n`;
    }
    
    // 参考资料
    if (briefData.references && briefData.references.length > 0) {
      content += `## 参考资料\n\n`;
      for (const ref of briefData.references) {
        content += `- ${ref}\n`;
      }
      content += `\n`;
    }
    
    // 验收标准
    if (briefData.acceptanceCriteria) {
      content += `## 验收标准\n\n`;
      if (Array.isArray(briefData.acceptanceCriteria)) {
        for (const criteria of briefData.acceptanceCriteria) {
          content += `- ${criteria}\n`;
        }
      } else {
        content += `${briefData.acceptanceCriteria}\n`;
      }
      content += `\n`;
    }
    
    content += `---\n\n`;
    content += `**Brief版本**: U4-P1-v1.0\n`;
    content += `**生成者**: FBS-BookWriter v1.59C\n`;
    
    return content;
  }

  /**
   * 读取Chapter Brief
   * @param {number} chapterNumber - 章节号
   * @returns {string|null}
   */
  load(chapterNumber) {
    const filename = `brief-ch${chapterNumber}.md`;
    const filepath = path.join(this.briefsDir, filename);
    
    if (!fs.existsSync(filepath)) {
      console.warn(`⚠️ [U4-P1] Brief不存在: ${filepath}`);
      return null;
    }
    
    const content = fs.readFileSync(filepath, 'utf-8');
    console.log(`📖 [U4-P1] 读取Brief: ${filepath}`);
    
    return content;
  }

  /**
   * 检查Brief是否存在
   * @param {number} chapterNumber - 章节号
   * @returns {boolean}
   */
  exists(chapterNumber) {
    const filename = `brief-ch${chapterNumber}.md`;
    const filepath = path.join(this.briefsDir, filename);
    return fs.existsSync(filepath);
  }

  /**
   * 获取所有Brief列表
   * @returns {Array}
   */
  getAllBriefs() {
    if (!fs.existsSync(this.briefsDir)) {
      return [];
    }
    
    const files = fs.readdirSync(this.briefsDir)
      .filter(file => file.startsWith('brief-ch') && file.endsWith('.md'))
      .sort();
    
    return files.map(file => {
      const chapterNumber = parseInt(file.replace('brief-ch', '').replace('.md', ''));
      return {
        filename: file,
        chapterNumber,
        path: `.fbs/briefs/${file}`
      };
    });
  }

  /**
   * 删除Brief
   * @param {number} chapterNumber - 章节号
   * @returns {boolean}
   */
  delete(chapterNumber) {
    const filename = `brief-ch${chapterNumber}.md`;
    const filepath = path.join(this.briefsDir, filename);
    
    if (!fs.existsSync(filepath)) {
      console.warn(`⚠️ [U4-P1] Brief不存在: ${filepath}`);
      return false;
    }
    
    fs.unlinkSync(filepath);
    console.log(`🗑️ [U4-P1] 删除Brief: ${filepath}`);
    
    return true;
  }
}

/**
 * 快速保存Chapter Brief
 * @param {number} chapterNumber - 章节号
 * @param {string} chapterTitle - 章节标题
 * @param {Object} briefData - Brief数据
 * @param {string} bookRoot - 书籍根目录
 * @returns {Promise<string>}
 */
export async function saveChapterBrief(chapterNumber, chapterTitle, briefData, bookRoot) {
  const saver = new ChapterBriefSaver(bookRoot);
  return saver.save(chapterNumber, chapterTitle, briefData);
}

// CLI入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const bookRoot = process.argv[2] || process.cwd();
  const chapterNumber = parseInt(process.argv[3]) || 1;
  
  console.log('========================================');
  console.log('U4: Chapter Brief强制落盘 (P1)');
  console.log('========================================\n');
  
  // 示例Brief数据
  const exampleBrief = {
    objective: '本章考证X氏家族的起源,包括早期历史记载、迁徙路线、分支形成等。',
    sections: [
      { number: '1.1', title: '起源考证', description: '考证X氏家族的起源,包括历史记载和考古发现' },
      { number: '1.2', title: '迁徙路线', description: '梳理X氏家族的迁徙路线和分布情况' },
      { number: '1.3', title: '分支形成', description: '分析X氏家族各分支的形成过程' }
    ],
    evidence: [
      '《XX》中的相关记载',
      '《XX史》中的相关记载',
      '《XX志》中的相关记载',
      '最新考古发现'
    ],
    materials: ['古籍扫描件', '考古报告', '族谱资料'],
    authorVoice: '学术严谨,考证详实,避免主观臆断',
    writingRequirements: [
      '每小节不少于1500字',
      '必须引用古籍证据',
      '必须联网查证最新考古发现',
      '保持学术风格'
    ],
    wordCount: {
      expected: '40000',
      min: '35000',
      max: '45000'
    },
    references: [
      '《左传》',
      '《史记》',
      '《通志》',
      '陶寺遗址考古报告'
    ],
    acceptanceCriteria: [
      '子节结构完整',
      '证据充分,引用准确',
      '字数达标',
      '符合学术规范'
    ]
  };
  
  const saver = new ChapterBriefSaver(bookRoot);
  
  saver.save(chapterNumber, `Ch${chapterNumber} 示例章节`, exampleBrief)
    .then((savedPath) => {
      console.log('\n✅ U4 完成');
      console.log(`保存路径: ${savedPath}`);
      console.log('\n所有Brief列表:');
      const briefs = saver.getAllBriefs();
      briefs.forEach(b => console.log(`  - ${b.path} (Ch${b.chapterNumber})`));
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ U4 失败:', error.message);
      process.exit(1);
    });
}

export default ChapterBriefSaver;
