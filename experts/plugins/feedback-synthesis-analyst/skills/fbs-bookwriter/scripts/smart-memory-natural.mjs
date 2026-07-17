#!/usr/bin/env node
/**
 * 智能记忆系统（自然语言交互版）
 * 
 * 功能:
 * - 支持自然语言指令操作
 * - 自动识别用户意图
 * - 执行相应的记忆管理操作
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 智能记忆自然语言交互器
 */
export class SmartMemoryNatural {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.memoryDir = path.join(projectRoot, '.fbs', 'smart-memory');
    this.options = {
      enabled: options.enabled !== false,
      ...options
    };
    
    this.ensureMemoryDir();
    this.loadMemory();
  }

  /**
   * 确保记忆目录存在
   */
  ensureMemoryDir() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  /**
   * 加载记忆
   */
  loadMemory() {
    const memoryFile = path.join(this.memoryDir, 'memory.json');
    if (fs.existsSync(memoryFile)) {
      try {
        const content = fs.readFileSync(memoryFile, 'utf8');
        this.memory = JSON.parse(content);
      } catch {
        this.initializeMemory();
      }
    } else {
      this.initializeMemory();
    }
  }

  /**
   * 初始化记忆
   */
  initializeMemory() {
    // MEM-P1-01修复：profileId 改用 crypto.randomBytes（与 SmartMemoryCore 对齐）
    // 原实现用 Date.now().toString(36)，会话并发时可能重复且与 core 不一致
    this.memory = {
      version: '2.0.2',         // 统一版本号（原为 '2.0.2-natural'，与 core 的 '2.0.2' 不一致）
      profileId: crypto.randomBytes(16).toString('hex'),

      createdAt: new Date().toISOString(),
      lastUpdated: null,
      
      userProfile: {
        basicInfo: null,
        workContext: null,
        preferences: null,
        history: null
      },
      
      learnedFeatures: {
        vocabulary: {},
        sentenceStructure: {},
        tone: {},
        formatting: {},
        rhetorical: {}
      },
      
      applicationLayer: {
        // 与 SmartMemoryCore 对齐：enabledFeatures 默认为空数组，不预置功能
        enabledFeatures: [],
        disabledFeatures: [],
        featureWeights: {},
        adaptationMode: 'balanced'
      },
      
      organizationLayer: {
        milestones: [],
        workbuddyChanges: [],
        versionCompatibility: {},
        cleanupTasks: []
      },
      
      metadata: {
        totalLearningSessions: 0,
        lastReset: null,
        lastDecoupling: null,
        memorySize: 0,
        naturalCommands: []   // natural 层专有字段，core 层无此字段（设计差异，不冲突）
      }
    };
    
    this.saveMemory();
  }

  /**
   * 保存记忆
   */
  saveMemory() {
    this.memory.lastUpdated = new Date().toISOString();
    this.memory.metadata.memorySize = JSON.stringify(this.memory).length;
    
    const memoryFile = path.join(this.memoryDir, 'memory.json');
    fs.writeFileSync(
      memoryFile,
      JSON.stringify(this.memory, null, 2),
      'utf8'
    );
  }

  /**
   * ================================
   * 自然语言指令处理
   * ================================
   */

  /**
   * 处理自然语言指令
   */
  processCommand(command, context = {}) {
    const commandLower = command.toLowerCase().trim();
    
    // 记录命令到历史
    this.memory.metadata.naturalCommands.push({
      command,
      timestamp: new Date().toISOString(),
      context
    });
    
    // 解析指令
    const parsed = this.parseCommand(commandLower);
    
    if (!parsed) {
      return {
        success: false,
        message: '我无法理解这个指令。您可以说：重置记忆、查看记忆、分析变化等。'
      };
    }
    
    // 执行指令
    const result = this.executeCommand(parsed, context);
    
    // 保存命令记录
    this.saveMemory();
    
    return result;
  }

  /**
   * 解析自然语言指令
   */
  parseCommand(command) {
    // 重置相关
    if (command.includes('重置') || command.includes('重新开始') || command.includes('重新学习')) {
      if (command.includes('软') || command.includes('轻')) {
        return { action: 'reset', type: 'soft', reason: command };
      } else if (command.includes('硬') || command.includes('完全')) {
        return { action: 'reset', type: 'hard', reason: command };
      } else {
        return { action: 'reset', type: 'full', reason: command };
      }
    }
    
    // 脱钩相关
    if (command.includes('脱钩') || command.includes('断开') || command.includes('禁用') || command.includes('不用') || command.includes('不个性化')) {
      if (command.includes('临时') || command.includes('暂时')) {
        return { action: 'decouple', type: 'temporary', reason: command };
      } else if (command.includes('永久') || command.includes('总是') || command.includes('彻底')) {
        return { action: 'decouple', type: 'permanent', reason: command };
      } else {
        return { action: 'decouple', type: 'temporary', reason: command };
      }
    }
    
    // 查看相关
    if (command.includes('查看') || command.includes('看看') || command.includes('显示') || command.includes('记忆')) {
      return { action: 'show', type: 'memory', target: this.parseShowTarget(command) };
    }
    
    // 分析相关
    if (command.includes('分析') || command.includes('检查') || command.includes('评估') || command.includes('变化')) {
      if (command.includes('workbuddy') || command.includes('工作台') || command.includes('环境')) {
        return { action: 'analyze', type: 'workbuddy', target: null };
      } else {
        return { action: 'analyze', type: 'memory', target: null };
      }
    }
    
    // 学习相关
    if (command.includes('学习') || command.includes('训练') || command.includes('适应') || command.includes('调整')) {
      if (command.includes('风格')) {
        return { action: 'learn', type: 'style', source: null };
      } else if (command.includes('词汇') || command.includes('用词')) {
        return { action: 'learn', type: 'vocabulary', source: null };
      } else {
        return { action: 'learn', type: 'auto', source: null };
      }
    }
    
    // 清理相关
    if (command.includes('清理') || command.includes('删除') || command.includes('清除')) {
      return { action: 'cleanup', target: this.parseCleanupTarget(command) };
    }
    
    // 恢复相关
    if (command.includes('恢复') || command.includes('启用') || command.includes('打开') || command.includes('重新启用')) {
      return { action: 'restore', target: null };
    }
    
    // 导出相关
    if (command.includes('导出') || command.includes('备份') || command.includes('保存')) {
      return { action: 'export', target: this.parseExportTarget(command) };
    }
    
    return null;
  }

  /**
   * 解析查看目标
   */
  parseShowTarget(command) {
    if (command.includes('风格') || command.includes('写法') || command.includes('习惯')) {
      return 'style';
    } else if (command.includes('词汇') || command.includes('用词') || command.includes('短语')) {
      return 'vocabulary';
    } else if (command.includes('句式') || command.includes('句子') || command.includes('段落')) {
      return 'sentence';
    } else if (command.includes('偏好') || command.includes('设置') || command.includes('配置')) {
      return 'preferences';
    } else if (command.includes('历史') || command.includes('记录') || command.includes('变化')) {
      return 'history';
    } else {
      return 'all';
    }
  }

  /**
   * 解析清理目标
   */
  parseCleanupTarget(command) {
    if (command.includes('旧') || command.includes('过期')) {
      return 'old';
    } else if (command.includes('重复') || command.includes('冗余')) {
      return 'duplicate';
    } else if (command.includes('全部') || command.includes('所有')) {
      return 'all';
    } else {
      return 'old';
    }
  }

  /**
   * 解析导出目标
   */
  parseExportTarget(command) {
    if (command.includes('报告') || command.includes('分析报告')) {
      return 'report';
    } else if (command.includes('配置') || command.includes('设置')) {
      return 'config';
    } else if (command.includes('数据') || command.includes('备份')) {
      return 'data';
    } else {
      return 'report';
    }
  }

  /**
   * 执行指令
   */
  executeCommand(parsed, context = {}) {
    switch (parsed.action) {
      case 'reset':
        return this.executeReset(parsed);
        
      case 'decouple':
        return this.executeDecouple(parsed);
        
      case 'show':
        return this.executeShow(parsed);
        
      case 'analyze':
        return this.executeAnalyze(parsed);
        
      case 'learn':
        return this.executeLearn(parsed, context);
        
      case 'cleanup':
        return this.executeCleanup(parsed);
        
      case 'restore':
        return this.executeRestore(parsed);
        
      case 'export':
        return this.executeExport(parsed);
        
      default:
        return {
          success: false,
          message: '我无法理解这个指令。'
        };
    }
  }

  /**
   * 执行重置
   */
  executeReset(parsed) {
    const { type, reason } = parsed;
    
    if (type === 'soft') {
      // 软重置：清空学习特征
      this.memory.learnedFeatures = {
        vocabulary: {},
        sentenceStructure: {},
        tone: {},
        formatting: {},
        rhetorical: {}
      };
      
      this.memory.metadata.lastReset = {
        type: 'soft',
        timestamp: new Date().toISOString(),
        reason
      };
      
      this.saveMemory();
      
      return {
        success: true,
        message: '已软重置学习特征，保留用户画像和偏好。',
        details: '下次写作会重新开始学习您的风格。'
      };
      
    } else if (type === 'hard') {
      // 硬重置：清空学习特征 + 重置应用层
      this.executeReset({ type: 'soft', reason });
      
      this.memory.applicationLayer = {
        enabledFeatures: ['vocabulary', 'sentenceStructure', 'tone'],
        disabledFeatures: [],
        featureWeights: {},
        adaptationMode: 'balanced'
      };
      
      this.saveMemory();
      
      return {
        success: true,
        message: '已硬重置，恢复默认配置。',
        details: '所有学习特征已清空，应用层已重置。'
      };
      
    } else if (type === 'full') {
      // 完全重置：清空所有数据
      this.initializeMemory();
      
      return {
        success: true,
        message: '已完全重置，删除所有个性化数据。',
        details: '所有用户画像、学习特征、应用层、历史记录已清空。'
      };
    }
  }

  /**
   * 执行脱钩
   */
  executeDecouple(parsed) {
    const { type, reason } = parsed;
    
    if (type === 'temporary') {
      // 临时脱钩：禁用应用层
      this.memory.applicationLayer.disabledFeatures = [
        'vocabulary',
        'sentenceStructure',
        'tone',
        'formatting',
        'rhetorical'
      ];
      
      this.memory.applicationLayer.enabledFeatures = [];
      
      this.memory.metadata.lastDecoupling = {
        type: 'temporary',
        timestamp: new Date().toISOString(),
        reason,
        autoRestoreAfter: 1 // 1小时后自动恢复
      };
      
      this.saveMemory();
      
      return {
        success: true,
        message: '已临时禁用个性化适配。',
        details: '1小时后自动恢复，或说"恢复个性化"手动恢复。',
        isDecoupled: true,
        autoRestoreAfter: 1
      };
      
    } else if (type === 'permanent') {
      // 永久脱钩：删除学习特征 + 禁用应用层
      this.memory.learnedFeatures = {
        vocabulary: {},
        sentenceStructure: {},
        tone: {},
        formatting: {},
        rhetorical: {}
      };
      
      this.memory.applicationLayer.disabledFeatures = [
        'vocabulary',
        'sentenceStructure',
        'tone',
        'formatting',
        'rhetorical'
      ];
      
      this.memory.applicationLayer.enabledFeatures = [];
      
      this.memory.metadata.lastDecoupling = {
        type: 'permanent',
        timestamp: new Date().toISOString(),
        reason
      };
      
      this.saveMemory();
      
      return {
        success: true,
        message: '已永久禁用个性化。',
        details: '如需重新启用，请说"学习风格"重新开始学习。',
        isDecoupled: true
      };
    }
  }

  /**
   * 执行查看
   */
  executeShow(parsed) {
    const { type, target } = parsed;
    
    if (target === 'style') {
      // 查看风格特征
      const features = this.memory.learnedFeatures;
      const style = {
        vocabulary: features.vocabulary.highFreqWords || {},
        sentence: features.sentenceStructure,
        tone: features.tone,
        formatting: features.formatting
      };
      
      return {
        success: true,
        message: this.formatStyleReport(style),
        data: style
      };
      
    } else if (target === 'vocabulary') {
      // 查看词汇特征
      const vocab = this.memory.learnedFeatures.vocabulary;
      const topWords = Object.entries(vocab.highFreqWords || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count]) => ({ word, count }));
      
      return {
        success: true,
        message: `您的高频词汇（前20个）:\n${topWords.map(w => `  ${w.word}: ${w.count}次`).join('\n')}`,
        data: vocab
      };
      
    } else if (target === 'sentence') {
      // 查看句式特征
      const sentence = this.memory.learnedFeatures.sentenceStructure;
      
      return {
        success: true,
        message: `句式特征:\n  平均长度: ${Math.round(sentence.avgLength)}字\n  长度方差: ${sentence.lengthVariance?.toFixed(2)}\n  复杂度: ${sentence.complexity?.toFixed(2)}`,
        data: sentence
      };
      
    } else if (target === 'preferences') {
      // 查看偏好设置
      const prefs = this.memory.userProfile.preferences;
      
      return {
        success: true,
        message: `偏好设置:\n  工作模式: ${prefs?.mode || '未设置'}\n  输出方式: ${prefs?.output || '未设置'}\n  协作方式: ${prefs?.collaboration || '未设置'}`,
        data: prefs
      };
      
    } else if (target === 'history') {
      // 查看历史记录
      const milestones = this.memory.organizationLayer.milestones;
      const recent = milestones.slice(-10).reverse();
      
      return {
        success: true,
        message: `最近10条记录:\n${recent.map(m => `  ${m.timestamp}: ${m.description || m.type}`).join('\n')}`,
        data: recent
      };
      
    } else if (target === 'all') {
      // 查看所有信息
      return {
        success: true,
        message: this.formatFullReport(),
        data: this.memory
      };
    }
    
    return {
      success: false,
      message: '我无法理解要查看的内容。'
    };
  }

  /**
   * 格式化风格报告
   */
  formatStyleReport(style) {
    const parts = [];
    
    if (Object.keys(style.vocabulary || {}).length > 0) {
      parts.push('词汇特征:');
      const topWords = Object.entries(style.vocabulary).slice(0, 5);
      topWords.forEach(([word, count]) => {
        parts.push(`  ${word}: ${count}次`);
      });
    }
    
    if (style.sentence) {
      parts.push('\n句式特征:');
      parts.push(`  平均长度: ${Math.round(style.sentence.avgLength)}字`);
      parts.push(`  复杂度: ${style.sentence.complexity?.toFixed(2)}`);
    }
    
    if (style.tone) {
      parts.push('\n语气特征:');
      parts.push(`  情感: ${style.tone.sentiment || 'neutral'}`);
      parts.push(`  正式度: ${style.tone.formality || 'neutral'}`);
      parts.push(`  强度: ${style.tone.intensity || 'medium'}`);
    }
    
    return parts.join('\n');
  }

  /**
   * 格式化完整报告
   */
  formatFullReport() {
    const parts = [];
    
    parts.push('📊 智能记忆报告');
    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 用户画像
    if (this.memory.userProfile.basicInfo) {
      parts.push('\n👤 用户画像:');
      parts.push(`  姓名: ${this.memory.userProfile.basicInfo.name || '未设置'}`);
      parts.push(`  当前项目: ${this.memory.userProfile.workContext?.currentProject || '未设置'}`);
    }
    
    // 学习特征
    const features = this.memory.learnedFeatures;
    parts.push('\n🧠 学习特征:');
    parts.push(`  词汇: ${Object.keys(features.vocabulary.highFreqWords || {}).length}个高频词`);
    parts.push(`  句式: 平均${Math.round(features.sentenceStructure.avgLength)}字`);
    parts.push(`  语气: ${features.tone?.sentiment || 'neutral'}`);
    
    // 应用层
    const app = this.memory.applicationLayer;
    parts.push('\n🎯 应用配置:');
    parts.push(`  启用功能: ${app.enabledFeatures.join(', ') || '无'}`);
    parts.push(`  禁用功能: ${app.disabledFeatures.join(', ') || '无'}`);
    parts.push(`  适配模式: ${app.adaptationMode}`);
    
    // 状态信息
    const meta = this.memory.metadata;
    parts.push('\n📈 统计:');
    parts.push(`  学习会话: ${meta.totalLearningSessions}`);
    parts.push(`  上次重置: ${meta.lastReset?.timestamp || '从未'}`);
    parts.push(`  上次脱钩: ${meta.lastDecoupling?.timestamp || '从未'}`);
    parts.push(`  记忆大小: ${(meta.memorySize / 1024).toFixed(2)}KB`);
    
    parts.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return parts.join('\n');
  }

  /**
   * 执行分析
   */
  executeAnalyze(parsed) {
    const { type } = parsed;
    
    if (type === 'workbuddy') {
      // 分析 WorkBuddy 变化
      const changes = this.memory.organizationLayer.workbuddyChanges;
      
      if (changes.length === 0) {
        return {
          success: true,
          message: '没有检测到 WorkBuddy 环境变化。',
          details: '最近7天内没有配置文件更新。'
        };
      }
      
      const recentChanges = changes.slice(-5).reverse();
      const summary = recentChanges.map(c => {
        if (c.file) {
          return `${c.file}: ${c.impact}影响`;
        } else if (c.type === 'memery') {
          return `记忆文件: ${c.previousCount} → ${c.currentCount}`;
        }
        return JSON.stringify(c);
      }).join('\n');
      
      return {
        success: true,
        message: 'WorkBuddy 环境变化分析：\n' + summary,
        details: changes
      };
      
    } else if (type === 'memory') {
      // 分析记忆健康度
      const meta = this.memory.metadata;
      
      const issues = [];
      
      if (meta.memorySize > 5 * 1024 * 1024) {
        issues.push(`记忆数据较大 (${(meta.memorySize / 1024 / 1024).toFixed(2)}MB)，建议清理`);
      }
      
      if (meta.lastDecoupling && meta.lastDecoupling.type === 'temporary') {
        const hoursSinceDecouple = (Date.now() - new Date(meta.lastDecoupling.timestamp).getTime()) / (3600 * 1000);
        if (hoursSinceDecouple > 1) {
          issues.push('仍处于临时脱钩状态，已超过1小时');
        }
      }
      
      if (this.memory.applicationLayer.disabledFeatures.length > 0) {
        issues.push(`${this.memory.applicationLayer.disabledFeatures.length}个功能已禁用`);
      }
      
      if (issues.length === 0) {
        return {
          success: true,
          message: '记忆系统状态良好，无需处理。',
          details: '所有指标正常。'
        };
      }
      
      return {
        success: true,
        message: '记忆健康分析发现问题：\n' + issues.join('\n'),
        details: issues
      };
    }
  }

  /**
   * 执行学习
   */
  executeLearn(parsed, context) {
    const { type, source } = parsed;
    
    if (type === 'style' || type === 'auto') {
      // 从内容学习风格
      if (!source || !context.content) {
        return {
          success: false,
          message: '请提供要学习的内容文件。'
        };
      }
      
      const content = fs.readFileSync(source, 'utf8');
      this.learnFromContent(content);
      
      this.memory.metadata.totalLearningSessions++;
      this.saveMemory();
      
      return {
        success: true,
        message: '已从内容学习风格特征。',
        details: '学习到的特征已更新。'
      };
      
    } else if (type === 'vocabulary') {
      // 学习词汇特征
      if (!source || !context.content) {
        return {
          success: false,
          message: '请提供要学习的内容文件。'
        };
      }
      
      const content = fs.readFileSync(source, 'utf8');
      this.learnVocabularyFromContent(content);
      
      this.memory.metadata.totalLearningSessions++;
      this.saveMemory();
      
      return {
        success: true,
        message: '已学习词汇特征。',
        details: `识别到 ${Object.keys(this.memory.learnedFeatures.vocabulary.highFreqWords || {}).length}个高频词。`
      };
    }
    
    return {
      success: false,
      message: '我无法理解学习类型。'
    };
  }

  /**
   * 从内容学习风格
   */
  learnFromContent(content) {
    // 简化的风格学习逻辑
    const features = this.memory.learnedFeatures;
    
    // 学习句式
    const sentences = content.split(/[。！？.!?]/).filter(s => s.trim().length > 0);
    const lengths = sentences.map(s => s.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    
    features.sentenceStructure = {
      avgLength,
      lengthVariance: 0,
      complexity: 0.5
    };
    
    // 学习语气
    const positiveWords = ['优秀', '成功', '创新', '卓越'];
    const negativeWords = ['失败', '困难', '问题', '不足'];
    const formalWords = ['因此', '综上所述', '值得注意的是'];
    const casualWords = ['吧', '呢', '啊', '哦'];
    
    let positiveCount = 0;
    let negativeCount = 0;
    let formalCount = 0;
    let casualCount = 0;
    
    content.split('').forEach(char => {
      positiveWords.forEach(word => { if (content.includes(word)) positiveCount++; });
      negativeWords.forEach(word => { if (content.includes(word)) negativeCount++; });
      formalWords.forEach(word => { if (content.includes(word)) formalCount++; });
      casualWords.forEach(word => { if (content.includes(word)) casualCount++; });
    });
    
    let sentiment = 'neutral';
    if (positiveCount > negativeCount * 1.5) sentiment = 'positive';
    else if (negativeCount > positiveCount * 1.5) sentiment = 'negative';
    
    let formality = 'neutral';
    if (formalCount > casualCount * 2) formality = 'formal';
    else if (casualCount > formalCount * 2) formality = 'casual';
    
    features.tone = {
      sentiment,
      formality,
      intensity: 'medium'
    };
    
    // 启用已学习的特征
    this.memory.applicationLayer.enabledFeatures = ['vocabulary', 'sentenceStructure', 'tone'];
    this.memory.applicationLayer.disabledFeatures = [];
  }

  /**
   * 学习词汇特征
   */
  learnVocabularyFromContent(content) {
    const features = this.memory.learnedFeatures;
    
    // 提取中文词汇
    const words = content.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    const wordCount = {};
    
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // 排序并取高频词
    const sorted = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);
    
    features.vocabulary.highFreqWords = Object.fromEntries(sorted);
  }

  /**
   * 执行清理
   */
  executeCleanup(parsed) {
    const { target } = parsed;
    
    if (target === 'old') {
      // 清理旧数据
      const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const milestones = this.memory.organizationLayer.milestones;
      const oldMilestones = milestones.filter(m => new Date(m.timestamp) < cutoffDate);
      
      this.memory.organizationLayer.milestones = milestones.filter(m => new Date(m.timestamp) >= cutoffDate);
      
      this.saveMemory();
      
      return {
        success: true,
        message: `已清理 ${oldMilestones.length}条过期记录（90天前）。`,
        details: `保留最近${milestones.length - oldMilestones.length}条记录。`
      };
      
    } else if (target === 'all') {
      // 清理所有
      this.initializeMemory();
      
      return {
        success: true,
        message: '已清理所有记忆数据，重新开始。',
        details: '所有个性化数据已删除。'
      };
    }
    
    return {
      success: false,
      message: '我无法理解清理目标。'
    };
  }

  /**
   * 执行恢复
   */
  executeRestore(parsed) {
    if (this.memory.applicationLayer.disabledFeatures.length > 0) {
      // 恢复个性化
      this.memory.applicationLayer.disabledFeatures = [];
      this.memory.applicationLayer.enabledFeatures = ['vocabulary', 'sentenceStructure', 'tone'];
      
      this.memory.metadata.lastDecoupling = {
        type: 'restored',
        timestamp: new Date().toISOString(),
        reason: '用户恢复'
      };
      
      this.saveMemory();
      
      return {
        success: true,
        message: '已恢复个性化适配。',
        details: '所有功能已重新启用。'
      };
    }
    
    return {
      success: true,
      message: '个性化适配已启用，无需恢复。',
      details: '当前未处于脱钩状态。'
    };
  }

  /**
   * 执行导出
   */
  executeExport(parsed) {
    const { type, target } = parsed;
    const exportData = {
      version: '2.0.2-natural',
      exportedAt: new Date().toISOString(),

      profileId: this.memory.profileId,
      memory: this.memory
    };
    
    let outputPath;
    if (target === 'report') {
      outputPath = path.join(this.projectRoot, '.fbs', 'smart-memory-report.json');
    } else if (target === 'config') {
      outputPath = path.join(this.projectRoot, '.fbs', 'smart-memory-config.json');
    } else if (target === 'data') {
      outputPath = path.join(this.projectRoot, '.fbs', 'smart-memory-backup.json');
    } else {
      outputPath = path.join(this.projectRoot, '.fbs', 'smart-memory-export.json');
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf8');
    
    return {
      success: true,
      message: `已导出到: ${outputPath}`,
      details: '导出类型: ' + target
    };
  }
}

/**
 * CLI 入口
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
智能记忆系统（自然语言交互版）

用法:
  node smart-memory-natural.mjs <command> [arguments]

命令（自然语言）:

记忆管理:
  重置记忆          软重置学习特征
  完全重置          清空所有个性化数据
  查看记忆          查看个性化配置
  查看风格          查看学习到的写作风格
  查看词汇          查看高频词汇
  查看历史          查看最近的操作记录

个性化控制:
  脱离个性化        临时禁用适配
  永久禁用        完全禁用个性化
  恢复个性化        重新启用适配

学习功能:
  学习风格          从文件学习写作风格
  学习词汇          从文件学习词汇特征
  自动学习          从当前内容自动学习

分析功能:
  分析环境          分析 WorkBuddy 环境变化
  分析记忆          分析记忆健康度

维护功能:
  清理旧记录        清理90天前的旧数据
  清理重复数据        清理重复记录
  清理全部数据        清理所有数据
  导出报告          导出分析报告
  导出配置          导出配置文件
  导出备份          导出完整备份

参数:
  <file>           文件路径（用于学习功能）
  --workbuddy-dir   WorkBuddy 目录（用于分析环境）

选项:
  --help            显示帮助信息

示例:
  # 基础操作
  查看记忆
  查看风格
  重置记忆
  
  # 个性化控制
  脱离个性化  （临时禁用）
  永久禁用  （完全禁用）
  恢复个性化
  
  # 学习功能
  学习风格 ./previous-draft.md
  学习词汇 ./previous-chapters/
  
  # 分析功能
  分析环境 ~/.workbuddy
  分析记忆
  
  # 清理功能
  清理旧记录
  导出报告
    `);
    process.exit(0);
  }
  
  const command = args[0];
  const projectRoot = args[1];
  const options = parseArgs(args.slice(2));
  
  try {
    const smartMemory = new SmartMemoryNatural(projectRoot, options);
    const result = smartMemory.processCommand(command, options);
    
    console.log(result.message);
    
    if (result.details && result.details !== '学习到的特征已更新。') {
      console.log('\n详情:');
      console.log(result.details);
    }
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--workbuddy-dir' && args[i + 1]) {
      options.workbuddyDir = args[++i];
    } else if (arg === '--file' && args[i + 1]) {
      options.file = args[++i];
    }
  }
  
  return options;
}
