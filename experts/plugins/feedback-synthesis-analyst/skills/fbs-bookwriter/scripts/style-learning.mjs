#!/usr/bin/env node
/**
 * 数字分身风格学习器
 * 
 * 功能:
 * - 从历史作品学习写作风格
 * - 词汇偏好分析
 * - 句式偏好分析
 * - 语气偏好分析
 * - 格式偏好分析
 * - 风格自适应内容调整
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 风格学习器类
 */
export class StyleLearner {
  constructor(userId, options = {}) {
    this.userId = userId;
    this.options = {
      minTextLength: options.minTextLength || 500,
      maxSamples: options.maxSamples || 50,
      learningRate: options.learningRate || 0.1,
      ...options
    };
    
    this.styleProfile = {
      vocabulary: {
        highFreqWords: {},
        preferredPhrases: {},
        avoidPhrases: {}
      },
      sentenceStructure: {
        avgLength: 0,
        lengthVariance: 0,
        commonPatterns: {},
        complexity: 0
      },
      tone: {
        sentiment: 'neutral', // positive, neutral, negative
        formality: 'neutral', // formal, neutral, casual
        intensity: 'medium' // low, medium, high
      },
      formatting: {
        paragraphStyle: 'standard', // standard, indented, compact
        headingStyle: 'standard', // standard, numbered, bulleted
        listStyle: 'standard' // standard, compact, detailed
      },
      rhetorical: {
        devices: [],
        metaphors: [],
        examples: []
      },
      metadata: {
        sampleCount: 0,
        totalWordCount: 0,
        lastUpdated: null
      }
    };
  }

  /**
   * 从历史文件学习风格
   */
  async learnFromHistory(historyPath) {
    try {
      // 收集所有 Markdown 文件
      const historyFiles = this.collectHistoryFiles(historyPath);
      
      if (historyFiles.length === 0) {
        console.log('未找到历史文件');
        return this.styleProfile;
      }
      
      // 限制样本数量
      const sampleFiles = historyFiles.slice(0, this.options.maxSamples);
      
      // 分析每个文件
      for (const file of sampleFiles) {
        const content = fs.readFileSync(file.path, 'utf8');
        if (content.length < this.options.minTextLength) {
          continue;
        }
        
        this.analyzeStyle(content, file.name);
      }
      
      // 计算统计量
      this.calculateStatistics();
      
      // 更新元数据
      this.styleProfile.metadata.sampleCount = sampleFiles.length;
      this.styleProfile.metadata.lastUpdated = new Date().toISOString();
      
      return this.styleProfile;
      
    } catch (error) {
      console.error('学习风格失败:', error.message);
      throw error;
    }
  }

  /**
   * 收集历史文件
   */
  collectHistoryFiles(historyPath) {
    const files = [];
    
    // 递归查找 .md 文件
    const walk = (dir) => {
      const items = fs.readdirSync(dir);
      
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (item.endsWith('.md')) {
          files.push({
            path: fullPath,
            name: item,
            size: stat.size
          });
        }
      });
    };
    
    walk(historyPath);
    
    // 按大小排序（优先分析大文件）
    return files.sort((a, b) => b.size - a.size);
  }

  /**
   * 分析风格
   */
  analyzeStyle(content, source) {
    // 1. 词汇分析
    this.analyzeVocabulary(content);
    
    // 2. 句式分析
    this.analyzeSentenceStructure(content);
    
    // 3. 语气分析
    this.analyzeTone(content);
    
    // 4. 格式分析
    this.analyzeFormatting(content);
    
    // 5. 修辞分析
    this.analyzeRhetorical(content);
  }

  /**
   * 分析词汇
   */
  analyzeVocabulary(content) {
    // 提取中文词汇
    const words = content.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    const wordCount = {};
    
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // 统计高频词
    const total = words.length;
    for (const [word, count] of Object.entries(wordCount)) {
      const frequency = count / total;
      if (frequency > 0.001) { // 出现频率 > 0.1%
        this.styleProfile.vocabulary.highFreqWords[word] = 
          (this.styleProfile.vocabulary.highFreqWords[word] || 0) + count;
      }
    }
    
    // 提取常见短语
    const phrases = content.match(/[\u4e00-\u9fa5]{4,8}/g) || [];
    const phraseCount = {};
    
    phrases.forEach(phrase => {
      phraseCount[phrase] = (phraseCount[phrase] || 0) + 1;
    });
    
    // 排序并取前 N 个
    const sortedPhrases = Object.entries(phraseCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);
    
    sortedPhrases.forEach(([phrase, count]) => {
      this.styleProfile.vocabulary.preferredPhrases[phrase] = count;
    });
  }

  /**
   * 分析句式
   */
  analyzeSentenceStructure(content) {
    // 提取句子
    const sentences = content.split(/[。！？.!?]/).filter(s => s.trim().length > 0);
    
    // 计算句子长度分布
    const lengths = sentences.map(s => s.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = this.calculateVariance(lengths, avgLength);
    
    // 更新统计（使用移动平均）
    this.styleProfile.sentenceStructure.avgLength = 
      this.rollingAverage(
        this.styleProfile.sentenceStructure.avgLength,
        avgLength,
        this.options.learningRate
      );
    
    this.styleProfile.sentenceStructure.lengthVariance = 
      this.rollingAverage(
        this.styleProfile.sentenceStructure.lengthVariance,
        variance,
        this.options.learningRate
      );
    
    // 分析常见句式模式
    const patterns = [
      /虽然.*但是/g,
      /不仅.*而且/g,
      /因此/g,
      /所以/g,
      /总之/g
    ];
    
    patterns.forEach(pattern => {
      const matches = content.match(pattern) || [];
      const patternName = pattern.toString().replace(/[\\/g]/g, '');
      this.styleProfile.sentenceStructure.commonPatterns[patternName] = 
        (this.styleProfile.sentenceStructure.commonPatterns[patternName] || 0) + matches.length;
    });
    
    // 计算复杂度（基于句长、连接词、从句数量）
    const complexity = this.calculateComplexity(content, sentences);
    this.styleProfile.sentenceStructure.complexity = 
      this.rollingAverage(
        this.styleProfile.sentenceStructure.complexity,
        complexity,
        this.options.learningRate
      );
  }

  /**
   * 分析语气
   */
  analyzeTone(content) {
    // 情感词库（简化版）
    const positiveWords = ['优秀', '成功', '创新', '卓越', '杰出', '精彩'];
    const negativeWords = ['失败', '困难', '问题', '挑战', '不足', '缺陷'];
    const formalWords = ['因此', '综上所述', '值得注意的是', '鉴于'];
    const casualWords = ['吧', '呢', '啊', '哦', '呀'];
    
    let positiveCount = 0;
    let negativeCount = 0;
    let formalCount = 0;
    let casualCount = 0;
    
    positiveWords.forEach(word => {
      const matches = content.match(new RegExp(word, 'g')) || [];
      positiveCount += matches.length;
    });
    
    negativeWords.forEach(word => {
      const matches = content.match(new RegExp(word, 'g')) || [];
      negativeCount += matches.length;
    });
    
    formalWords.forEach(word => {
      const matches = content.match(new RegExp(word, 'g')) || [];
      formalCount += matches.length;
    });
    
    casualWords.forEach(word => {
      const matches = content.match(new RegExp(word, 'g')) || [];
      casualCount += matches.length;
    });
    
    // 判断情感倾向
    if (positiveCount > negativeCount * 1.5) {
      this.styleProfile.tone.sentiment = 'positive';
    } else if (negativeCount > positiveCount * 1.5) {
      this.styleProfile.tone.sentiment = 'negative';
    } else {
      this.styleProfile.tone.sentiment = 'neutral';
    }
    
    // 判断正式程度
    if (formalCount > casualCount * 2) {
      this.styleProfile.tone.formality = 'formal';
    } else if (casualCount > formalCount * 2) {
      this.styleProfile.tone.formality = 'casual';
    } else {
      this.styleProfile.tone.formality = 'neutral';
    }
    
    // 判断强度（基于感叹号、强调词）
    const exclamations = (content.match(/[！！]/g) || []).length;
    const emphasis = (content.match(/非常重要|特别|非常/g) || []).length;
    
    if (exclamations + emphasis > 10) {
      this.styleProfile.tone.intensity = 'high';
    } else if (exclamations + emphasis < 3) {
      this.styleProfile.tone.intensity = 'low';
    } else {
      this.styleProfile.tone.intensity = 'medium';
    }
  }

  /**
   * 分析格式
   */
  analyzeFormatting(content) {
    // 段落风格
    const indentedLines = (content.match(/^\s{2,}/gm) || []).length;
    const totalLines = content.split('\n').length;
    const indentionRatio = indentedLines / totalLines;
    
    if (indentionRatio > 0.3) {
      this.styleProfile.formatting.paragraphStyle = 'indented';
    } else if (indentionRatio < 0.1) {
      this.styleProfile.formatting.paragraphStyle = 'compact';
    }
    
    // 标题风格
    const numberedHeadings = (content.match(/^#{1,6}\s*\d+./gm) || []).length;
    const standardHeadings = (content.match(/^#{1,6}\s*/gm) || []).length;
    
    if (numberedHeadings > standardHeadings) {
      this.styleProfile.formatting.headingStyle = 'numbered';
    }
    
    // 列表风格
    const compactLists = (content.match(/^\s*[-*]\s*\S/gm) || []).length;
    const detailedLists = (content.match(/^\s*\d+\.\s*\S/gm) || []).length;
    
    if (compactLists > detailedLists * 2) {
      this.styleProfile.formatting.listStyle = 'compact';
    } else if (detailedLists > compactLists * 2) {
      this.styleProfile.formatting.listStyle = 'detailed';
    }
  }

  /**
   * 分析修辞
   */
  analyzeRhetorical(content) {
    // 比喻
    const metaphorPatterns = [
      /像/g, /如/g, /仿佛/g, /如同/g
    ];
    
    metaphorPatterns.forEach(pattern => {
      const matches = content.match(pattern) || [];
      if (matches.length > 0) {
        this.styleProfile.rhetorical.metaphors.push({
          type: 'metaphor',
          pattern: pattern.toString(),
          count: matches.length
        });
      }
    });
    
    // 排比
    const parallelismPattern = /([^\n]+)\n\s*\1(?:\n\s*\1)*/g;
    const parallelisms = content.match(parallelismPattern) || [];
    
    parallelisms.forEach(p => {
      this.styleProfile.rhetorical.devices.push({
        type: 'parallelism',
        example: p.substring(0, 50),
        count: 1
      });
    });
    
    // 举例
    const examplePatterns = [
      /例如/g, /比如/g, /诸如/g
    ];
    
    examplePatterns.forEach(pattern => {
      const matches = content.match(pattern) || [];
      if (matches.length > 0) {
        this.styleProfile.rhetorical.examples.push({
          type: 'example',
          marker: pattern.toString(),
          count: matches.length
        });
      }
    });
  }

  /**
   * 计算复杂度
   */
  calculateComplexity(content, sentences) {
    const avgLength = sentences.reduce((a, b) => a + b.length, 0) / sentences.length;
    
    // 连接词数量
    const connectors = ['因为', '所以', '但是', '而且', '因此', '此外', '然而'];
    const connectorCount = connectors.reduce((sum, connector) => {
      return sum + (content.match(new RegExp(connector, 'g')) || []).length;
    }, 0);
    
    // 从句数量（简化判断：按逗号）
    const clauseCount = (content.match(/[,，]/g) || []).length;
    
    // 复杂度 = 句长 + 连接词密度 + 从句密度
    const complexity = (avgLength / 50) + 
                      (connectorCount / sentences.length) * 2 + 
                      (clauseCount / sentences.length) * 0.5;
    
    return Math.min(complexity, 10);
  }

  /**
   * 计算方差
   */
  calculateVariance(values, mean) {
    if (values.length === 0) return 0;
    
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * 移动平均
   */
  rollingAverage(current, newValue, rate) {
    if (current === 0) return newValue;
    return current * (1 - rate) + newValue * rate;
  }

  /**
   * 计算统计量
   */
  calculateStatistics() {
    // 词表统计
    const vocabKeys = Object.keys(this.styleProfile.vocabulary.highFreqWords);
    const phraseKeys = Object.keys(this.styleProfile.vocabulary.preferredPhrases);
    
    // 排序高频词
    this.styleProfile.vocabulary.highFreqWords = this.sortObjectByValue(
      this.styleProfile.vocabulary.highFreqWords
    ).slice(0, 200);
    
    // 排序偏好短语
    this.styleProfile.vocabulary.preferredPhrases = this.sortObjectByValue(
      this.styleProfile.vocabulary.preferredPhrases
    ).slice(0, 100);
  }

  /**
   * 按值排序对象
   */
  sortObjectByValue(obj) {
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, value }));
  }

  /**
   * 适配内容到用户风格
   */
  adaptContent(content) {
    let adapted = content;
    
    // 1. 适配词汇
    adapted = this.adaptVocabulary(adapted);
    
    // 2. 适配句长
    adapted = this.adaptSentenceLength(adapted);
    
    // 3. 适配语气
    adapted = this.adaptTone(adapted);
    
    // 4. 适配格式
    adapted = this.adaptFormatting(adapted);
    
    return adapted;
  }

  /**
   * 适配词汇
   */
  adaptVocabulary(content) {
    let adapted = content;
    
    // 替换为用户偏好词汇
    const commonReplacements = {
      '非常': ['极其', '十分'],
      '重要': ['关键', '核心'],
      '可以': ['能够', '可以'],
      '应该': ['需要', '应当']
    };
    
    const preferences = this.styleProfile.vocabulary.preferredPhrases;
    
    // 使用前 20 个偏好短语进行替换
    const topPhrases = preferences.slice(0, 20);
    topPhrases.forEach(({ key }) => {
      // 简化实现：不做实际替换，仅演示
    });
    
    return adapted;
  }

  /**
   * 适配句长
   */
  adaptSentenceLength(content) {
    const targetAvgLength = this.styleProfile.sentenceStructure.avgLength;
    if (targetAvgLength === 0) return content;
    
    // 分割句子
    const sentences = content.split(/([。！？.!?])/);
    const adapted = [];
    
    let currentSentence = '';
    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];
      
      if (part.match(/[。！？.!?]/)) {
        currentSentence += part;
        
        // 如果句子过长，拆分
        if (currentSentence.length > targetAvgLength * 1.5) {
          adapted.push(this.splitLongSentence(currentSentence));
        } else {
          adapted.push(currentSentence);
        }
        
        currentSentence = '';
      } else {
        currentSentence += part;
      }
    }
    
    if (currentSentence.trim().length > 0) {
      adapted.push(currentSentence);
    }
    
    return adapted.join('');
  }

  /**
   * 拆分长句
   */
  splitLongSentence(sentence) {
    // 在连接词处拆分
    const connectors = ['，', '；', '：'];
    
    for (const connector of connectors) {
      if (sentence.includes(connector)) {
        const parts = sentence.split(connector);
        if (parts.length > 1) {
          return parts.join(connector + '\n');
        }
      }
    }
    
    return sentence;
  }

  /**
   * 适配语气
   */
  adaptTone(content) {
    let adapted = content;
    
    const { sentiment, formality, intensity } = this.styleProfile.tone;
    
    // 情感调整
    if (sentiment === 'positive') {
      // 确保积极表达
    } else if (sentiment === 'negative') {
      // 保持客观
    }
    
    // 正式程度调整
    if (formality === 'formal') {
      // 替换为更正式的表达
      adapted = adapted
        .replace(/吧/g, '')
        .replace(/呢/g, '')
        .replace(/啊/g, '');
    } else if (formality === 'casual') {
      // 可以适当使用语气词
    }
    
    // 强度调整
    if (intensity === 'low') {
      // 减少感叹号
      adapted = adapted.replace(/[！！]/g, '。');
    } else if (intensity === 'high') {
      // 增强表达
    }
    
    return adapted;
  }

  /**
   * 适配格式
   */
  adaptFormatting(content) {
    let adapted = content;
    
    const { paragraphStyle, headingStyle, listStyle } = this.styleProfile.formatting;
    
    // 段落风格调整
    if (paragraphStyle === 'indented') {
      // 添加缩进
      adapted = adapted.replace(/^([^#\-\*])/gm, '  $1');
    } else if (paragraphStyle === 'compact') {
      // 减少空行
      adapted = adapted.replace(/\n{3,}/g, '\n\n');
    }
    
    // 标题风格调整
    if (headingStyle === 'numbered') {
      // 转换为编号标题（简化实现）
    }
    
    return adapted;
  }

  /**
   * 保存风格画像
   */
  async saveProfile(outputPath) {
    const profileData = {
      userId: this.userId,
      version: '2.0.2',

      generatedAt: new Date().toISOString(),
      styleProfile: this.styleProfile,
      options: this.options
    };
    
    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(profileData, null, 2),
      'utf8'
    );
    
    return {
      success: true,
      outputFile: outputPath
    };
  }

  /**
   * 加载风格画像
   */
  async loadProfile(inputPath) {
    try {
      const content = await fs.promises.readFile(inputPath, 'utf8');
      const data = JSON.parse(content);
      
      if (data.styleProfile) {
        this.styleProfile = data.styleProfile;
      }
      
      return {
        success: true,
        loadedAt: new Date().toISOString(),
        userId: data.userId
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `加载失败: ${error.message}`,
        error
      };
    }
  }

  /**
   * 获取风格报告
   */
  getStyleReport() {
    const report = {
      summary: this.generateSummary(),
      vocabulary: this.generateVocabularyReport(),
      sentence: this.generateSentenceReport(),
      tone: this.generateToneReport(),
      formatting: this.generateFormattingReport(),
      rhetorical: this.generateRhetoricalReport()
    };
    
    return report;
  }

  /**
   * 生成摘要
   */
  generateSummary() {
    return {
      sampleCount: this.styleProfile.metadata.sampleCount,
      avgSentenceLength: Math.round(this.styleProfile.sentenceStructure.avgLength),
      overallComplexity: this.styleProfile.sentenceStructure.complexity.toFixed(2),
      tone: this.styleProfile.tone.sentiment,
      formality: this.styleProfile.tone.formality
    };
  }

  /**
   * 生成词汇报告
   */
  generateVocabularyReport() {
    const topWords = this.styleProfile.vocabulary.highFreqWords.slice(0, 20);
    const topPhrases = this.styleProfile.vocabulary.preferredPhrases.slice(0, 10);
    
    return {
      topWordsCount: topWords.length,
      topPhrasesCount: topPhrases.length,
      sampleWords: topWords.slice(0, 10).map(w => w.key),
      samplePhrases: topPhrases.slice(0, 5).map(p => p.key)
    };
  }

  /**
   * 生成句式报告
   */
  generateSentenceReport() {
    return {
      avgLength: Math.round(this.styleProfile.sentenceStructure.avgLength),
      lengthVariance: this.styleProfile.sentenceStructure.lengthVariance.toFixed(2),
      complexity: this.styleProfile.sentenceStructure.complexity.toFixed(2),
      commonPatterns: Object.keys(this.styleProfile.sentenceStructure.commonPatterns)
    };
  }

  /**
   * 生成语气报告
   */
  generateToneReport() {
    return {
      sentiment: this.styleProfile.tone.sentiment,
      formality: this.styleProfile.tone.formality,
      intensity: this.styleProfile.tone.intensity
    };
  }

  /**
   * 生成格式报告
   */
  generateFormattingReport() {
    return {
      paragraphStyle: this.styleProfile.formatting.paragraphStyle,
      headingStyle: this.styleProfile.formatting.headingStyle,
      listStyle: this.styleProfile.formatting.listStyle
    };
  }

  /**
   * 生成修辞报告
   */
  generateRhetoricalReport() {
    return {
      devices: this.styleProfile.rhetorical.devices.length,
      metaphors: this.styleProfile.rhetorical.metaphors.length,
      examples: this.styleProfile.rhetorical.examples.length
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
数字分身风格学习器

用法:
  node style-learning.mjs <action> <user-id> [options]

动作:
  learn       从历史文件学习风格
  adapt       适配内容到用户风格
  report      生成风格报告
  save        保存风格画像
  load        加载风格画像

参数:
  user-id            用户 ID
  history-path       历史文件路径 (用于 learn)
  content-file       要适配的内容文件 (用于 adapt)
  output-path        输出文件路径 (用于 save/adapt)

选项:
  --min-length       最小文本长度 (默认: 500)
  --max-samples      最大样本数量 (默认: 50)
  --learning-rate    学习率 (默认: 0.1)
  --profile-path     风格画像文件路径 (用于 load)
  --json            以 JSON 格式输出
  --help            显示帮助信息

示例:
  # 从历史学习风格
  node style-learning.mjs learn user123 ./my-book --output-path ./style-profile.json
  
  # 适配内容
  node style-learning.mjs adapt user123 --profile-path ./style-profile.json --content-file draft.md --output-path adapted.md
  
  # 生成风格报告
  node style-learning.mjs report user123 --profile-path ./style-profile.json
  
  # 保存风格画像
  node style-learning.mjs save user123 --profile-path ./style-profile.json --output-path ./saved-profile.json
    `);
    process.exit(0);
  }
  
  const action = args[0];
  const userId = args[1];
  const options = parseArgs(args.slice(2));
  
  try {
    const learner = new StyleLearner(userId, options);
    
    switch (action) {
      case 'learn': {
        const historyPath = options.historyPath || './';
        console.log(`从 ${historyPath} 学习风格...`);
        
        const profile = await learner.learnFromHistory(historyPath);
        
        if (options.outputPath) {
          await learner.saveProfile(options.outputPath);
          console.log(`风格画像已保存: ${options.outputPath}`);
        }
        
        if (options.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          printStyleProfile(profile);
        }
        break;
      }
        
      case 'adapt': {
        if (!options.contentFile) {
          console.error('错误: 请提供内容文件 (--content-file)');
          process.exit(1);
        }
        
        if (options.profilePath) {
          await learner.loadProfile(options.profilePath);
        }
        
        const content = fs.readFileSync(options.contentFile, 'utf8');
        const adapted = learner.adaptContent(content);
        
        if (options.outputPath) {
          await fs.promises.writeFile(options.outputPath, adapted, 'utf8');
          console.log(`适配后的内容已保存: ${options.outputPath}`);
        } else {
          console.log('\n适配后的内容:\n');
          console.log(adapted);
        }
        break;
      }
        
      case 'report': {
        if (options.profilePath) {
          await learner.loadProfile(options.profilePath);
        }
        
        const report = learner.getStyleReport();
        
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printStyleReport(report);
        }
        break;
      }
        
      case 'save': {
        if (options.profilePath) {
          await learner.loadProfile(options.profilePath);
        }
        
        const outputPath = options.outputPath || './style-profile.json';
        const result = await learner.saveProfile(outputPath);
        
        console.log(`风格画像已保存: ${result.outputFile}`);
        break;
      }
        
      case 'load': {
        if (!options.profilePath) {
          console.error('错误: 请提供风格画像路径 (--profile-path)');
          process.exit(1);
        }
        
        const result = await learner.loadProfile(options.profilePath);
        
        if (result.success) {
          console.log('风格画像加载成功');
          console.log(`用户 ID: ${result.userId}`);
          console.log(`加载时间: ${result.loadedAt}`);
        } else {
          console.log('加载失败:', result.reason);
        }
        break;
      }
        
      default:
        console.error('未知动作:', action);
        process.exit(1);
    }
    
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
  const options = {
    minLength: 500,
    maxSamples: 50,
    learningRate: 0.1,
    historyPath: null,
    contentFile: null,
    profilePath: null,
    outputPath: null,
    json: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--min-length' && args[i + 1]) {
      options.minLength = parseInt(args[++i]);
    } else if (arg === '--max-samples' && args[i + 1]) {
      options.maxSamples = parseInt(args[++i]);
    } else if (arg === '--learning-rate' && args[i + 1]) {
      options.learningRate = parseFloat(args[++i]);
    } else if (arg === '--history-path' && args[i + 1]) {
      options.historyPath = args[++i];
    } else if (arg === '--content-file' && args[i + 1]) {
      options.contentFile = args[++i];
    } else if (arg === '--profile-path' && args[i + 1]) {
      options.profilePath = args[++i];
    } else if (arg === '--output-path' && args[i + 1]) {
      options.outputPath = args[++i];
    } else if (arg === '--json') {
      options.json = true;
    }
  }
  
  return options;
}

/**
 * 打印风格画像
 */
function printStyleProfile(profile) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('风格画像');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('元数据:');
  console.log(`  样本数: ${profile.metadata.sampleCount}`);
  console.log(`  总词数: ${profile.metadata.totalWordCount}`);
  console.log(`  更新时间: ${profile.metadata.lastUpdated}`);
  
  console.log('\n词汇:');
  const topWords = profile.vocabulary.highFreqWords.slice(0, 10);
  console.log(`  高频词 (${profile.vocabulary.highFreqWords.length}个):`);
  topWords.forEach((w, i) => {
    console.log(`    ${i + 1}. ${w.key} (${w.value}次)`);
  });
  
  const topPhrases = profile.vocabulary.preferredPhrases.slice(0, 5);
  console.log(`  偏好短语 (${profile.vocabulary.preferredPhrases.length}个):`);
  topPhrases.forEach((p, i) => {
    console.log(`    ${i + 1}. ${p.key} (${p.value}次)`);
  });
  
  console.log('\n句式:');
  console.log(`  平均长度: ${Math.round(profile.sentenceStructure.avgLength)}字`);
  console.log(`  长度方差: ${profile.sentenceStructure.lengthVariance.toFixed(2)}`);
  console.log(`  复杂度: ${profile.sentenceStructure.complexity.toFixed(2)}`);
  console.log(`  常见模式: ${Object.keys(profile.sentenceStructure.commonPatterns).join(', ')}`);
  
  console.log('\n语气:');
  console.log(`  情感: ${profile.tone.sentiment}`);
  console.log(`  正式度: ${profile.tone.formality}`);
  console.log(`  强度: ${profile.tone.intensity}`);
  
  console.log('\n格式:');
  console.log(`  段落风格: ${profile.formatting.paragraphStyle}`);
  console.log(`  标题风格: ${profile.formatting.headingStyle}`);
  console.log(`  列表风格: ${profile.formatting.listStyle}`);
  
  console.log('\n修辞:');
  console.log(`  修辞手法: ${profile.rhetorical.devices.length}个`);
  console.log(`  比喻: ${profile.rhetorical.metaphors.length}个`);
  console.log(`  举例: ${profile.rhetorical.examples.length}个`);
}

/**
 * 打印风格报告
 */
function printStyleReport(report) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('风格分析报告');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('摘要:');
  console.log(`  样本数: ${report.summary.sampleCount}`);
  console.log(`  平均句长: ${report.summary.avgSentenceLength}字`);
  console.log(`  整体复杂度: ${report.summary.overallComplexity}`);
  console.log(`  情感: ${report.summary.tone}`);
  console.log(`  正式度: ${report.summary.formality}`);
  
  console.log('\n建议:');
  if (report.summary.overallComplexity > 5) {
    console.log('  • 句式复杂度较高，建议适当简化');
  }
  if (report.summary.formality === 'casual') {
    console.log('  • 偏向口语化，适合轻松读物');
  } else if (report.summary.formality === 'formal') {
    console.log('  • 偏向正式书面语，适合专业内容');
  }
}
