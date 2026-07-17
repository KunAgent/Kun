#!/usr/bin/env node
/**
 * FBS-BookWriter NLU优化系统增强版
 * 
 * 针对审计中发现的问题进行全面优化：
 * 1. 提升意图识别准确率（从82%目标提升至95%+）
 * 2. 增加触发词覆盖度（从75%目标提升至90%+）
 * 3. 优化上下文理解能力
 * 4. 增强模糊匹配效果
 * 5. 优化缓存策略
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const NLU_ENHANCED = {
  version: '2.0.2-enhanced',

  lastUpdated: '2026-04-08',
  
  // 性能目标
  performanceTargets: {
    intentRecognitionRate: 0.95,  // 从82%提升至95%
    triggerCoverage: 0.90,       // 从75%提升至90%
    contextUnderstanding: 0.90,   // 从70%提升至90%
    averageResponseTime: 800,     // 从1000ms优化至800ms
    cacheHitRate: 0.85           // 新增：缓存命中率目标
  },
  
  // ========================================
  // 增强的意图识别系统
  // ========================================
  enhancedIntentSystem: {
    // 使用向量相似度进行语义匹配
    semanticMatching: {
      enabled: true,
      algorithm: 'cosine_similarity',
      threshold: 0.75,
      
      // 意图向量库（简化版，实际应使用预训练模型）
      intentVectors: {
        ACTIVATE_ONLY: ['福帮手', '福帮手写书skill', '启动福帮手', '打开福帮手'],
        WRITE_BOOK: ['写', '创作', '书籍', '手册', '报告', '文档', '内容', '改写', '拆书', '本地化'],
        ACTIVATE_MATERIAL: ['素材', '材料', '资料', '数据', '文档', '文件', '整理'],

        CONTINUE: ['继续', '接着', '往下', '后续', '然后', '下一步'],
        REVIEW: ['检查', '审核', '审阅', '校对', '质量', '优化', '改进'],
        EXPORT: ['导出', '下载', '生成', '输出', '打包', 'PDF', 'Word'],
        STRATEGY: ['策略', '模式', '深度', '调整', '切换', '改变'],
        STATUS: ['进度', '状态', '完成', '情况', '进展', '到哪里'],
        STOP: ['停止', '终止', '取消', '中断', '退出', '暂停', '退出福帮手', '关闭福帮手', 'exit skill'],

        HELP: ['帮助', '怎么用', '如何', '指导', '教程', '入门'],
        CONFIRM_TOPIC: ['确认', '是的', '对', '好的', '可以', '没错'],
        
        // 智能记忆相关意图
        SMART_MEMORY_RESET: ['重置', '清空', '删除', '记忆', '学习', '偏好'],
        SMART_MEMORY_VIEW: ['查看', '显示', '风格', '特征', '个性', '记忆状态'],
        SMART_MEMORY_DECOUPLE: ['脱离', '脱钩', '断开', '个性化', '普通模式'],
        SMART_MEMORY_ENABLE: ['恢复', '启用', '开启', '个性化', '智能模式'],
        SMART_MEMORY_HISTORY: ['历史', '记录', '学习进度', '学习情况', '统计'],
        SMART_MEMORY_BOUNDARY: ['边界', '应用', '适配', '强度', '程度', '范围'],
        SMART_MEMORY_ANALYZE: ['分析', '整理', '升级', '环境', '配置', '适配检查']
      }
    },
    
    // 机器学习辅助意图识别
    mlAssistedRecognition: {
      enabled: true,
      
      // 特征工程
      features: {
        ngrams: [2, 3, 4],  // 2-gram, 3-gram, 4-gram
        posTagging: true,    // 词性标注
        sentiment: true,     // 情感分析
        urgency: true       // 紧急度分析
      },
      
      // 集成学习
      ensemble: {
        algorithms: ['naive_bayes', 'random_forest', 'svm'],
        voting: 'weighted',
        confidenceThreshold: 0.8
      }
    },
    
    // 动态触发词学习
    dynamicTriggerLearning: {
      enabled: true,
      
      // 从用户输入中学习新触发词
      learningRules: {
        minFrequency: 3,        // 最小出现频率
        minConfidence: 0.85,    // 最小置信度
        maxNewTriggers: 20,     // 最大新增触发词数
        learningPeriod: '7d'     // 学习周期
      },
      
      // 触发词验证
      validationRules: {
        mustContain: [],         // 必须包含的关键词
        mustNotContain: [],      // 不能包含的关键词
        minLength: 2,            // 最小长度
        maxLength: 20            // 最大长度
      }
    }
  },
  
  // ========================================
  // 增强的模糊匹配系统
  // ========================================
  enhancedFuzzyMatching: {
    // 编辑距离算法
    levenshteinDistance: {
      enabled: true,
      maxDistance: 2,           // 最大编辑距离
      caseInsensitive: true,
      weightings: {
        substitution: 1,        // 替换权重
        insertion: 1,           // 插入权重
        deletion: 1,            // 删除权重
        transposition: 1        // 交换权重
      }
    },
    
    // Soundex发音相似度
    phoneticSimilarity: {
      enabled: true,
      algorithm: 'soundex',
      threshold: 0.8
    },
    
    // 余弦相似度
    cosineSimilarity: {
      enabled: true,
      threshold: 0.7,
      useTFIDF: true
    },
    
    // 混合匹配策略
    hybridMatching: {
      strategies: [
        { name: 'exact', weight: 1.0 },
        { name: 'levenshtein', weight: 0.9 },
        { name: 'phonetic', weight: 0.8 },
        { name: 'cosine', weight: 0.7 }
      ],
      aggregation: 'weighted_average'
    },
    
    // 常见错别字字典（扩展版）
    commonTypos: {
      '写书': ['写数', '写舒', '写叔', '写术'],
      '检查': ['捡查', '检阅', '简查', '减查'],
      '导出': ['道出', '导楚', '道楚'],
      '素材': ['素菜', '素财', '速材'],
      '继续': ['继绪', '接续', '接绪'],
      '质量': ['治量', '只量', '质亮'],
      '开始': ['开是', '开试', '开实'],
      '结束': ['结术', '杰书', '结束'],
      '帮助': ['帮柱', '帮主', '帮祝'],
      '策略': ['策劣', '策咧', '撤略'],
      '模式': ['莫式', '摸式', '磨式'],
      '深度': ['深渡', '神度', '沈度'],
      '文档': ['问档', '温档', '温单'],
      '报告': ['暴告', '包告', '报搞'],
      '手册': ['守册', '手策', '受策'],
      '创作': ['窗做', '闯作', '窗作'],
      '审核': ['审何', '申核', '沈核'],
      '优化': ['优画', '尤化', '忧化'],
      '整理': ['挣理', '正理', '政理'],
      '个性化': ['个姓化', '个性划', '个新化'],
      '记忆': ['记意', '计意', '纪意'],
      '学习': ['学习', '雪习', '穴习'],
      '风格': ['风格', '疯格', '逢格'],
      '特征': ['征长', '成征', '呈征'],
      '边界': ['变界', '遍界', '辨界'],
      '适配': ['试配', '施配', '失配'],
      '分析': ['粉析', '分昔', '吩晰'],
      '配置': ['陪致', '佩致', '配置'],
      '环境': ['环竟', '还境', '黄境']
    },
    
    // 拼音输入错误
    pinyinTypos: {
      'yixia': ['一下', '一下', '一下'],
      'kaishi': ['开始', '开是', '开试'],
      'jieshu': ['结束', '结术', '杰书'],
      'zhiliang': ['质量', '治量', '只量'],
      'bangzhu': ['帮助', '帮柱', '帮主'],
      'celue': ['策略', '策劣', '策咧'],
      'moshi': ['模式', '莫式', '摸式'],
      'shendu': ['深度', '深渡', '神度'],
      'wendang': ['文档', '问档', '温档'],
      'baogao': ['报告', '暴告', '包告']
    }
  },
  
  // ========================================
  // 增强的上下文理解
  // ========================================
  enhancedContextUnderstanding: {
    // 对话状态跟踪
    dialogStateTracking: {
      enabled: true,
      
      states: {
        IDLE: '空闲',
        GREETING: '问候',
        TOPIC_CONFIRMATION: '主题确认',
        WRITING: '写作中',
        REVIEWING: '审核中',
        EXPORTING: '导出中',
        AWAITING_INPUT: '等待输入',
        ERROR_HANDLING: '错误处理',
        HELP_MODE: '帮助模式'
      },
      
      // 状态转换规则
      transitionRules: {
        IDLE: ['GREETING', 'WRITING', 'HELP_MODE'],
        GREETING: ['TOPIC_CONFIRMATION', 'WRITING', 'HELP_MODE'],
        TOPIC_CONFIRMATION: ['WRITING', 'AWAITING_INPUT', 'IDLE'],
        WRITING: ['REVIEWING', 'EXPORTING', 'AWAITING_INPUT', 'IDLE'],
        REVIEWING: ['WRITING', 'EXPORTING', 'AWAITING_INPUT'],
        EXPORTING: ['IDLE', 'WRITING', 'HELP_MODE'],
        AWAITING_INPUT: ['WRITING', 'IDLE', 'HELP_MODE'],
        ERROR_HANDLING: ['IDLE', 'HELP_MODE'],
        HELP_MODE: ['IDLE', 'GREETING', 'WRITING']
      }
    },
    
    // 对话历史管理
    conversationHistory: {
      enabled: true,
      
      // 历史保留策略
      retentionPolicy: {
        maxTurns: 10,           // 最大轮数
        maxTokens: 2000,         // 最大token数
        retentionTime: '1h'      // 保留时间
      },
      
      // 历史压缩
      compression: {
        enabled: true,
        method: 'summary',
        summaryRatio: 0.5,       // 压缩比例
        keyInformationOnly: true  // 只保留关键信息
      },
      
      // 重要性评分
      importanceScoring: {
        factors: [
          { name: 'user_intent_change', weight: 0.3 },
          { name: 'task_completion', weight: 0.25 },
          { name: 'error_occurrence', weight: 0.2 },
          { name: 'time_elapsed', weight: 0.15 },
          { name: 'user_feedback', weight: 0.1 }
        ]
      }
    },
    
    // 用户意图推理
    intentInference: {
      enabled: true,
      
      // 推理规则
      inferenceRules: [
        {
          condition: 'short_response_after_question',
          inferredIntent: 'CONFIRM_TOPIC',
          confidence: 0.85
        },
        {
          condition: 'ambiguous_command_in_writing',
          inferredIntent: 'CONTINUE',
          confidence: 0.8
        },
        {
          condition: 'quality_related_keywords',
          inferredIntent: 'REVIEW',
          confidence: 0.9
        },
        {
          condition: 'file_format_keywords',
          inferredIntent: 'EXPORT',
          confidence: 0.95
        }
      ],
      
      // 上下文特征
      contextFeatures: {
        lastNIntents: 3,        // 考虑最近N个意图
        timeSinceLastIntent: 300, // 时间窗口（秒）
        userSatisfaction: true,  // 用户满意度
        taskCompletionRate: true  // 任务完成率
      }
    },
    
    // 多轮对话管理
    multiTurnDialog: {
      enabled: true,
      
      // 对话策略
      strategies: {
        clarification: {
          enabled: true,
          maxQuestions: 2,
          timeout: 30
        },
        confirmation: {
          enabled: true,
          requireConfirmation: ['WRITING', 'EXPORTING'],
          confirmationStyle: 'explicit'
        },
        fallback: {
          enabled: true,
          fallbackStrategy: 'suggest_options',
          maxFallbackAttempts: 3
        }
      },
      
      // 槽位填充
      slotFilling: {
        enabled: true,
        
        // 必需槽位
        requiredSlots: {
          WRITE_BOOK: ['topic', 'genre', 'length'],
          EXPORT: ['format', 'destination'],
          REVIEW: ['scope', 'level']
        },
        
        // 可选槽位
        optionalSlots: {
          WRITE_BOOK: ['style', 'audience', 'deadline'],
          EXPORT: ['filename', 'compression'],
          REVIEW: ['specific_aspects', 'correction_level']
        },
        
        // 槽位验证
        validation: {
          enabled: true,
          validateOnEntry: true,
          allowPartial: true
        }
      }
    }
  },
  
  // ========================================
  // 增强的缓存系统
  // ========================================
  enhancedCache: {
    // 多级缓存
    multiLevelCache: {
      enabled: true,
      levels: [
        {
          name: 'memory',
          maxSize: 1000,
          ttl: 300000,  // 5分钟
          evictionPolicy: 'lru'
        },
        {
          name: 'disk',
          maxSize: 10000,
          ttl: 3600000, // 1小时
          evictionPolicy: 'lfu',
          persistent: true
        }
      ]
    },
    
    // 智能预热
    intelligentPrewarming: {
      enabled: true,
      
      // 预热策略
      strategies: [
        {
          name: 'most_common',
          trigger: 'on_startup',
          count: 50
        },
        {
          name: 'recent_history',
          trigger: 'on_session_start',
          count: 100
        },
        {
          name: 'predicted_next',
          trigger: 'dynamic',
          count: 20
        }
      ]
    },
    
    // 缓存预测
    cachePrediction: {
      enabled: true,
      
      // 预测算法
      algorithm: 'markov_chain',
      
      // 预测特征
      features: [
        'intent_sequence',
        'time_of_day',
        'user_behavior',
        'context_state'
      ],
      
      // 预测准确度目标
      accuracyTarget: 0.8
    },
    
    // 自适应TTL
    adaptiveTTL: {
      enabled: true,
      
      // TTL调整策略
      strategies: [
        {
          condition: 'high_frequency',
          multiplier: 2.0
        },
        {
          condition: 'low_frequency',
          multiplier: 0.5
        },
        {
          condition: 'high_confidence',
          multiplier: 1.5
        },
        {
          condition: 'low_confidence',
          multiplier: 0.8
        }
      ],
      
      // 监控指标
      monitoringMetrics: [
        'hit_rate',
        'miss_rate',
        'eviction_rate',
        'size_utilization'
      ]
    }
  },
  
  // ========================================
  // 性能监控
  // ========================================
  performanceMonitoring: {
    // 实时监控
    realtimeMetrics: {
      enabled: true,
      
      metrics: [
        {
          name: 'intent_recognition_rate',
          target: 0.95,
          warningThreshold: 0.90,
          criticalThreshold: 0.85
        },
        {
          name: 'trigger_coverage',
          target: 0.90,
          warningThreshold: 0.85,
          criticalThreshold: 0.80
        },
        {
          name: 'context_understanding',
          target: 0.90,
          warningThreshold: 0.85,
          criticalThreshold: 0.80
        },
        {
          name: 'response_time',
          target: 800,
          warningThreshold: 1500,
          criticalThreshold: 3000,
          unit: 'ms'
        },
        {
          name: 'cache_hit_rate',
          target: 0.85,
          warningThreshold: 0.75,
          criticalThreshold: 0.65
        }
      ],
      
      // 告警策略
      alertStrategy: {
        warningActions: ['log', 'monitor'],
        criticalActions: ['log', 'alert', 'auto_adjust']
      }
    },
    
    // 性能优化建议
    optimizationSuggestions: {
      enabled: true,
      
      // 建议规则
      rules: [
        {
          condition: 'low_intent_recognition_rate',
          suggestion: '考虑增加训练数据或调整模型参数',
          priority: 'high'
        },
        {
          condition: 'low_cache_hit_rate',
          suggestion: '增加缓存大小或调整TTL策略',
          priority: 'medium'
        },
        {
          condition: 'high_response_time',
          suggestion: '优化算法或增加计算资源',
          priority: 'high'
        }
      ]
    }
  }
};

/**
 * 增强的NLU引擎
 */
export class EnhancedNLUEngine {
  constructor(config = NLU_ENHANCED) {
    this.config = config;
    this.context = {
      dialogState: 'IDLE',
      conversationHistory: [],
      slotValues: {},
      userPreferences: {}
    };
    
    this.multiLevelCache = new Map();
    this.performanceMetrics = {
      intentRecognitionRate: 0,
      triggerCoverage: 0,
      contextUnderstanding: 0,
      responseTime: 0,
      cacheHitRate: 0
    };
  }
  
  /**
   * 增强的意图识别
   */
  async enhancedRecognizeIntent(input, context = {}) {
    const startTime = Date.now();
    
    // 1. 多级缓存检查
    const cachedResult = this.checkMultiLevelCache(input, context);
    if (cachedResult) {
      this.updateMetrics({ cacheHit: true });
      return cachedResult;
    }
    
    // 2. 混合匹配策略
    const result = await this.hybridIntentMatching(input, context);
    
    // 3. 上下文感知推理
    const contextAwareResult = this.contextAwareInference(result, context);
    
    // 4. 槽位填充
    const filledResult = this.slotFilling(contextAwareResult, input);
    
    // 5. 缓存结果
    this.cacheResult(input, context, filledResult);
    
    // 6. 更新指标
    const responseTime = Date.now() - startTime;
    this.updateMetrics({ responseTime, cacheHit: false });
    
    return filledResult;
  }
  
  /**
   * 多级缓存检查
   */
  checkMultiLevelCache(input, context) {
    const cacheKey = this.generateCacheKey(input, context);
    
    // 检查内存缓存
    const memoryCache = this.multiLevelCache.get('memory');
    if (memoryCache && memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey);
      if (!this.isExpired(cached)) {
        this.performanceMetrics.cacheHitRate++;
        return cached.result;
      }
    }
    
    // 检查磁盘缓存
    const diskCache = this.multiLevelCache.get('disk');
    if (diskCache && diskCache.has(cacheKey)) {
      const cached = diskCache.get(cacheKey);
      if (!this.isExpired(cached)) {
        this.performanceMetrics.cacheHitRate++;
        return cached.result;
      }
    }
    
    return null;
  }
  
  /**
   * 混合意图匹配
   */
  async hybridIntentMatching(input, context) {
    const strategies = this.config.enhancedFuzzyMatching.hybridMatching.strategies;
    const results = [];
    
    // 1. 精确匹配
    const exactResult = this.exactMatch(input);
    if (exactResult) {
      results.push({ intent: exactResult, confidence: 1.0, method: 'exact' });
    }
    
    // 2. 编辑距离匹配
    const levenshteinResult = this.levenshteinMatch(input);
    if (levenshteinResult) {
      results.push({ ...levenshteinResult, method: 'levenshtein' });
    }
    
    // 3. 语义匹配
    const semanticResult = this.semanticMatch(input);
    if (semanticResult) {
      results.push({ ...semanticResult, method: 'semantic' });
    }
    
    // 4. 加权平均
    if (results.length > 0) {
      const weightedResult = this.weightedAverage(results, strategies);
      return weightedResult;
    }
    
    // 5. 兜底
    return { intent: 'HELP', confidence: 0.5, method: 'fallback' };
  }
  
  /**
   * 精确匹配
   */
  exactMatch(input) {
    const intentVectors = this.config.enhancedIntentSystem.semanticMatching.intentVectors;
    
    for (const [intent, keywords] of Object.entries(intentVectors)) {
      for (const keyword of keywords) {
        if (input.trim() === keyword) {
          return intent;
        }
      }
    }
    return null;
  }
  
  /**
   * 编辑距离匹配
   */
  levenshteinMatch(input) {
    const config = this.config.enhancedFuzzyMatching.levenshteinDistance;
    const intentVectors = this.config.enhancedIntentSystem.semanticMatching.intentVectors;
    
    for (const [intent, keywords] of Object.entries(intentVectors)) {
      for (const keyword of keywords) {
        const distance = this.calculateLevenshteinDistance(input, keyword);
        if (distance <= config.maxDistance) {
          const confidence = 1 - (distance / Math.max(input.length, keyword.length));
          return { intent, confidence };
        }
      }
    }
    return null;
  }
  
  /**
   * 计算编辑距离
   */
  calculateLevenshteinDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }
  
  /**
   * 语义匹配
   */
  semanticMatch(input) {
    const config = this.config.enhancedIntentSystem.semanticMatching;
    const intentVectors = config.intentVectors;
    const inputTokens = input.toLowerCase().split(/[\s,，。]+/).filter(w => w.length > 1);
    
    for (const [intent, keywords] of Object.entries(intentVectors)) {
      const matchedKeywords = keywords.filter(keyword => 
        inputTokens.some(token => token.includes(keyword) || keyword.includes(token))
      );
      
      if (matchedKeywords.length >= 2) {
        const confidence = Math.min(0.9, 0.5 + (matchedKeywords.length / keywords.length) * 0.4);
        return { intent, confidence };
      }
    }
    return null;
  }
  
  /**
   * 加权平均
   */
  weightedAverage(results, strategies) {
    let weightedSum = 0;
    let weightSum = 0;
    
    for (const result of results) {
      const strategy = strategies.find(s => s.name === result.method);
      if (strategy) {
        weightedSum += result.confidence * strategy.weight;
        weightSum += strategy.weight;
      }
    }
    
    return {
      intent: results[0].intent,
      confidence: weightSum > 0 ? weightedSum / weightSum : 0.5,
      methods: results.map(r => r.method)
    };
  }
  
  /**
   * 上下文感知推理
   */
  contextAwareInference(result, context) {
    const dialogState = this.context.dialogState;
    
    // 状态转换
    const transitionRules = this.config.enhancedContextUnderstanding.dialogStateTracking.transitionRules;
    const validTransitions = transitionRules[dialogState] || [];
    
    if (!validTransitions.includes(this.mapIntentToState(result.intent))) {
      // 无效的状态转换，尝试推理
      return this.inferIntent(result, context);
    }
    
    // 更新对话状态
    this.context.dialogState = this.mapIntentToState(result.intent);
    
    return result;
  }
  
  /**
   * 意图推理
   */
  inferIntent(result, context) {
    const inferenceRules = this.config.enhancedContextUnderstanding.intentInference.inferenceRules;
    
    for (const rule of inferenceRules) {
      if (this.checkCondition(rule.condition, context)) {
        return {
          ...result,
          intent: rule.inferredIntent,
          confidence: Math.min(result.confidence, rule.confidence),
          inferred: true
        };
      }
    }
    
    return result;
  }
  
  /**
   * 检查条件
   */
  checkCondition(condition, context) {
    // 简化实现，实际应该有更复杂的条件检查
    switch (condition) {
      case 'short_response_after_question':
        return context.lastQuestion && context.inputLength < 10;
      case 'ambiguous_command_in_writing':
        return this.context.dialogState === 'WRITING' && context.isAmbiguous;
      case 'quality_related_keywords':
        return /检查|审核|审阅|校对|质量|优化/.test(context.input);
      case 'file_format_keywords':
        return /pdf|word|html|docx|md/i.test(context.input);
      default:
        return false;
    }
  }
  
  /**
   * 槽位填充
   */
  slotFilling(result, input) {
    const slotFillingConfig = this.config.enhancedContextUnderstanding.multiTurnDialog.slotFilling;
    
    if (!slotFillingConfig.enabled) {
      return result;
    }
    
    const intent = result.intent;
    const requiredSlots = slotFillingConfig.requiredSlots[intent] || [];
    const optionalSlots = slotFillingConfig.optionalSlots[intent] || [];
    
    // 提取槽位值
    const extractedSlots = this.extractSlots(input, [...requiredSlots, ...optionalSlots]);
    
    // 更新上下文中的槽位值
    this.context.slotValues = {
      ...this.context.slotValues,
      ...extractedSlots
    };
    
    // 检查必需槽位是否已填充
    const missingSlots = requiredSlots.filter(slot => !this.context.slotValues[slot]);
    
    return {
      ...result,
      slots: {
        filled: Object.keys(extractedSlots),
        missing: missingSlots,
        all: this.context.slotValues
      },
      needsMoreInfo: missingSlots.length > 0
    };
  }
  
  /**
   * 提取槽位
   */
  extractSlots(input, slots) {
    const extracted = {};
    
    // 简化实现：基于关键词提取
    const patterns = {
      topic: /(?:写|创作)(?:关于|关于)?(.{2,20}?)(?:的|的书|的报告)/i,
      genre: /(书籍|手册|报告|指南|文档|白皮书)/i,
      length: /(\d+)(?:万字|千字|字)/,
      format: /(pdf|word|html|docx|markdown|md)/i,
      audience: /(?:给|面向)(.{2,10})/,
      deadline: /(?:截止|完成)(?:时间|日期)?(.{5,20})/
    };
    
    for (const slot of slots) {
      const pattern = patterns[slot];
      if (pattern) {
        const match = input.match(pattern);
        if (match && match[1]) {
          extracted[slot] = match[1].trim();
        }
      }
    }
    
    return extracted;
  }
  
  /**
   * 映射意图到状态
   */
  mapIntentToState(intent) {
    const mapping = {
      'ACTIVATE_ONLY': 'HELP_MODE',
      'WRITE_BOOK': 'WRITING',
      'ACTIVATE_MATERIAL': 'WRITING',
      'CONTINUE': 'WRITING',
      'REVIEW': 'REVIEWING',
      'EXPORT': 'EXPORTING',
      'HELP': 'HELP_MODE',
      'STOP': 'IDLE',
      'DEFAULT': 'IDLE'
    };

    
    return mapping[intent] || 'IDLE';
  }
  
  /**
   * 缓存结果
   */
  cacheResult(input, context, result) {
    const cacheKey = this.generateCacheKey(input, context);
    const cacheEntry = {
      result,
      timestamp: Date.now(),
      ttl: this.calculateAdaptiveTTL(result)
    };
    
    // 存入内存缓存
    let memoryCache = this.multiLevelCache.get('memory');
    if (!memoryCache) {
      memoryCache = new Map();
      this.multiLevelCache.set('memory', memoryCache);
    }
    
    memoryCache.set(cacheKey, cacheEntry);
    
    // 检查缓存大小
    const maxSize = this.config.enhancedCache.multiLevelCache.levels[0].maxSize;
    if (memoryCache.size > maxSize) {
      this.evictCache(memoryCache, 'lru');
    }
  }
  
  /**
   * 生成缓存键
   */
  generateCacheKey(input, context) {
    const keyString = `${input}_${JSON.stringify(context)}`;
    return createHash('md5').update(keyString).digest('hex');
  }
  
  /**
   * 计算自适应TTL
   */
  calculateAdaptiveTTL(result) {
    const baseTTL = this.config.enhancedCache.multiLevelCache.levels[0].ttl;
    
    if (result.confidence > 0.9) {
      return baseTTL * 2.0;
    } else if (result.confidence < 0.7) {
      return baseTTL * 0.8;
    }
    
    return baseTTL;
  }
  
  /**
   * 检查是否过期
   */
  isExpired(cacheEntry) {
    const now = Date.now();
    return now - cacheEntry.timestamp > cacheEntry.ttl;
  }
  
  /**
   * 缓存淘汰
   */
  evictCache(cache, policy) {
    switch (policy) {
      case 'lru':
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
        break;
      case 'lfu':
        let minAccessCount = Infinity;
        let lruKey = null;
        for (const [key, value] of cache.entries()) {
          if (value.accessCount < minAccessCount) {
            minAccessCount = value.accessCount;
            lruKey = key;
          }
        }
        if (lruKey) {
          cache.delete(lruKey);
        }
        break;
    }
  }
  
  /**
   * 更新性能指标
   */
  updateMetrics(metrics) {
    if (metrics.cacheHit !== undefined) {
      this.performanceMetrics.cacheHits = (this.performanceMetrics.cacheHits || 0) + (metrics.cacheHit ? 1 : 0);
      this.performanceMetrics.cacheRequests = (this.performanceMetrics.cacheRequests || 0) + 1;
    }
    
    if (metrics.responseTime !== undefined) {
      this.performanceMetrics.responseTime = metrics.responseTime;
    }
    
    // 计算缓存命中率
    if (this.performanceMetrics.cacheRequests > 0) {
      this.performanceMetrics.cacheHitRate = 
        this.performanceMetrics.cacheHits / this.performanceMetrics.cacheRequests;
    }
  }
  
  /**
   * 获取性能报告
   */
  getPerformanceReport() {
    const targets = this.config.performanceMonitoring.realtimeMetrics.metrics;
    const report = {
      current: {},
      targets: {},
      status: {}
    };
    
    for (const metric of targets) {
      const currentValue = this.performanceMetrics[metric.name.replace(/_([a-z])/g, (g) => g[1].toUpperCase())];
      if (currentValue !== undefined) {
        report.current[metric.name] = currentValue;
        report.targets[metric.name] = metric.target;
        
        if (currentValue >= metric.target) {
          report.status[metric.name] = 'good';
        } else if (currentValue >= metric.warningThreshold) {
          report.status[metric.name] = 'warning';
        } else {
          report.status[metric.name] = 'critical';
        }
      }
    }
    
    return report;
  }
  
  /**
   * 获取优化建议
   */
  getOptimizationSuggestions() {
    const suggestions = [];
    const config = this.config.performanceMonitoring.optimizationSuggestions;
    
    const performanceReport = this.getPerformanceReport();
    
    for (const rule of config.rules) {
      if (this.checkCondition(rule.condition, performanceReport)) {
        suggestions.push({
          priority: rule.priority,
          suggestion: rule.suggestion
        });
      }
    }
    
    return suggestions;
  }
  
  /**
   * 清除缓存
   */
  clearCache(level = 'all') {
    if (level === 'all' || level === 'memory') {
      this.multiLevelCache.set('memory', new Map());
    }
    if (level === 'all' || level === 'disk') {
      this.multiLevelCache.set('disk', new Map());
    }
  }
}

export default NLU_ENHANCED;
