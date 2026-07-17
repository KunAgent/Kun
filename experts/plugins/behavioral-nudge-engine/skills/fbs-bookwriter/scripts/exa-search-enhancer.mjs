#!/usr/bin/env node
/**
 * Exa 神经搜索增强器
 * 
 * 功能:
 * - 语义理解搜索（替代关键词搜索）
 * - 多步骤研究自动化
 * - 结果质量过滤与交叉验证
 * - 自动降级机制
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 高质量域名列表
 */
const HIGH_QUALITY_DOMAINS = new Set([
  // 政府与官方机构
  'gov.cn', 'gov.hk', 'gov.tw',
  // 学术机构
  'edu.cn', 'ac.cn', 'ac.uk', 'edu', 'ac.jp',
  // 权威媒体
  'xinhuanet.com', 'people.com.cn', 'cctv.com',
  'thepaper.cn', 'caixin.com', 'ftchinese.com',
  // 知名机构
  'nature.com', 'science.org', 'springer.com',
  'ieeexplore.ieee.org', 'dl.acm.org'
]);

/**
 * Exa 搜索增强器类
 */
export class ExaSearchEnhancer {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled || false,
      fallbackToWebSearch: config.fallbackToWebSearch !== false,
      qualityThreshold: config.qualityThreshold || 0.8,
      crossVerify: config.crossVerify !== false,
      maxResults: config.maxResults || 10,
      maxRetries: config.maxRetries || 3,
      ...config
    };
    
    this.searchLedger = [];
    this.domainReputation = new Map();
  }

  /**
   * 语义搜索
   */
  async semanticSearch(query, context = {}, options = {}) {
    const {
      numResults = this.config.maxResults,
      type = 'auto', // auto, fast, deep
      livecrawl = 'preferred',
      contextMaxCharacters = 5000
    } = options;
    
    try {
      if (!this.config.enabled) {
        return this.fallbackSearch(query, context);
      }

      // 构建语义查询
      const enhancedQuery = this.constructSemanticQuery(query, context);
      
      // 调用 Exa 搜索（模拟，实际需要调用 Exa MCP 服务）
      const results = await this.callExaSearch({
        query: enhancedQuery,
        numResults,
        type,
        livecrawl,
        contextMaxCharacters
      });
      
      // 结果质量过滤
      const qualityFiltered = this.filterByQuality(results, context);
      
      // 交叉验证
      const crossValidated = this.config.crossVerify 
        ? await this.crossVerifyFacts(qualityFiltered, query)
        : qualityFiltered;
      
      // 记录搜索日志
      this.logSearch({
        query: enhancedQuery,
        originalQuery: query,
        context,
        resultsCount: crossValidated.length,
        qualityScore: this.calculateQualityScore(crossValidated),
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        results: crossValidated,
        query: enhancedQuery,
        metadata: {
          source: 'exa',
          qualityScore: this.calculateQualityScore(crossValidated),
          crossVerified: this.config.crossVerify,
          fallbackUsed: false
        }
      };
      
    } catch (error) {
      console.error('Exa 搜索失败:', error.message);
      
      if (this.config.fallbackToWebSearch) {
        return this.fallbackSearch(query, context);
      }
      
      return {
        success: false,
        error: error.message,
        results: [],
        metadata: {
          source: 'exa',
          fallbackUsed: false,
          error: true
        }
      };
    }
  }

  /**
   * 深度研究（多步骤）
   */
  async deepResearch(topic, depth = 3) {
    const researchSteps = [];
    let currentDepth = 0;
    let accumulatedKnowledge = [];
    
    while (currentDepth < depth) {
      // 根据当前深度调整搜索策略
      const query = this.constructDeepSearchQuery(topic, currentDepth, accumulatedKnowledge);
      
      const searchResult = await this.semanticSearch(query, {
        depth: currentDepth,
        accumulatedKnowledge
      });
      
      if (!searchResult.success) {
        break;
      }
      
      researchSteps.push({
        depth: currentDepth,
        query,
        results: searchResult.results,
        insights: this.extractInsights(searchResult.results)
      });
      
      accumulatedKnowledge = this.accumulateKnowledge(accumulatedKnowledge, searchResult.results);
      currentDepth++;
    }
    
    // 生成研究报告
    const report = this.generateResearchReport(researchSteps, topic);
    
    return {
      success: true,
      topic,
      depth: currentDepth,
      steps: researchSteps,
      report,
      metadata: {
        totalQueries: researchSteps.length,
        totalResults: researchSteps.reduce((sum, step) => sum + step.results.length, 0)
      }
    };
  }

  /**
   * 构建语义查询
   */
  constructSemanticQuery(query, context) {
    let enhancedQuery = query;
    
    // 添加上下文信息
    if (context.genre) {
      enhancedQuery += ` ${context.genre}`;
    }
    if (context.audience) {
      enhancedQuery += ` 面向${context.audience}`;
    }
    if (context.timeRange) {
      enhancedQuery += ` ${context.timeRange}`;
    }
    
    // 优化为自然语言描述
    enhancedQuery = this.optimizeAsNaturalLanguage(enhancedQuery);
    
    return enhancedQuery;
  }

  /**
   * 优化为自然语言
   */
  optimizeAsNaturalLanguage(query) {
    // 替换为更具描述性的表达
    const replacements = [
      { pattern: /(\d{4})/g, replacement: '${年份}' },
      { pattern: /最新/g, replacement: '最近1年内' },
      { pattern: /当前/g, replacement: '目前' },
      { pattern: /数据/g, replacement: '统计数据' }
    ];
    
    let optimized = query;
    replacements.forEach(({ pattern, replacement }) => {
      optimized = optimized.replace(pattern, replacement);
    });
    
    return optimized;
  }

  /**
   * 调用 Exa 搜索（模拟实现）
   */
  async callExaSearch(params) {
    // 实际实现中，这里应该调用 Exa MCP 服务
    // 这里提供一个模拟实现用于测试
    
    console.log(`[Exa 搜索] 查询: "${params.query}"`);
    console.log(`[Exa 搜索] 参数:`, JSON.stringify({
      numResults: params.numResults,
      type: params.type
    }));
    
    // 模拟返回结果
    return this.simulateExaResults(params.query, params.numResults);
  }

  /**
   * 模拟 Exa 搜索结果
   */
  simulateExaResults(query, numResults) {
    const mockResults = [];
    
    for (let i = 0; i < numResults; i++) {
      mockResults.push({
        title: `${query} - 相关内容 ${i + 1}`,
        url: `https://example.com/result-${i + 1}`,
        content: `这是关于${query}的模拟内容 ${i + 1}`,
        score: 0.8 + Math.random() * 0.2,
        publishedDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
        author: `来源 ${i + 1}`
      });
    }
    
    return mockResults;
  }

  /**
   * 按质量过滤结果
   */
  filterByQuality(results, context) {
    return results.filter(result => {
      // 检查域名质量
      const domain = this.extractDomain(result.url);
      if (!this.isHighQualityDomain(domain)) {
        // 降低低质量域名的分数
        result.score *= 0.5;
      }
      
      // 检查内容相关性
      const relevance = this.calculateRelevance(result, context);
      result.score *= relevance;
      
      // 应用质量阈值
      return result.score >= this.config.qualityThreshold;
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * 交叉验证事实
   */
  async crossVerifyFacts(results, query) {
    const verifiedResults = [];
    
    for (const result of results) {
      const verificationScore = await this.verifyResult(result, query, results);
      result.verificationScore = verificationScore;
      
      if (verificationScore >= this.config.qualityThreshold) {
        verifiedResults.push(result);
      }
    }
    
    return verifiedResults;
  }

  /**
   * 验证单个结果
   */
  async verifyResult(result, query, allResults) {
    // 检查是否有多个独立来源支持
    const supportingSources = allResults.filter(r => 
      r !== result && this.areSourcesRelated(r, result)
    );
    
    const sourceScore = Math.min(supportingSources.length / 2, 1);
    const domainScore = this.isHighQualityDomain(this.extractDomain(result.url)) ? 1 : 0.5;
    const freshnessScore = this.calculateFreshnessScore(result.publishedDate);
    
    return (sourceScore * 0.4 + domainScore * 0.4 + freshnessScore * 0.2);
  }

  /**
   * 检查来源是否相关
   */
  areSourcesRelated(source1, source2) {
    // 简化实现：检查标题相似度
    const similarity = this.calculateSimilarity(source1.title, source2.title);
    return similarity > 0.6;
  }

  /**
   * 计算文本相似度
   */
  calculateSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = [...words1].filter(word => words2.has(word));
    const union = new Set([...words1, ...words2]);
    
    return intersection.length / union.length;
  }

  /**
   * 计算相关性
   */
  calculateRelevance(result, context) {
    if (!context || Object.keys(context).length === 0) {
      return 1.0;
    }
    
    let relevance = 1.0;
    
    // 检查体裁匹配
    if (context.genre && result.content) {
      const genreMatch = result.content.toLowerCase().includes(context.genre.toLowerCase());
      relevance *= genreMatch ? 1.2 : 0.8;
    }
    
    // 检查目标受众匹配
    if (context.audience && result.content) {
      const audienceMatch = result.content.toLowerCase().includes(context.audience.toLowerCase());
      relevance *= audienceMatch ? 1.1 : 0.9;
    }
    
    // 检查时间范围匹配
    if (context.timeRange && result.publishedDate) {
      const withinRange = this.isWithinTimeRange(result.publishedDate, context.timeRange);
      relevance *= withinRange ? 1.2 : 0.7;
    }
    
    return Math.min(relevance, 1.0);
  }

  /**
   * 检查是否在时间范围内
   */
  isWithinTimeRange(dateString, timeRange) {
    const date = new Date(dateString);
    const now = new Date();
    
    if (timeRange.includes('年')) {
      const years = parseInt(timeRange);
      const cutoff = new Date(now.getTime() - years * 365 * 24 * 60 * 60 * 1000);
      return date >= cutoff;
    }
    
    return true;
  }

  /**
   * 计算新鲜度分数
   */
  calculateFreshnessScore(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const daysOld = (now - date) / (24 * 60 * 60 * 1000);
    
    // 越新的内容分数越高
    if (daysOld < 7) return 1.0;
    if (daysOld < 30) return 0.9;
    if (daysOld < 90) return 0.8;
    if (daysOld < 180) return 0.7;
    if (daysOld < 365) return 0.6;
    return 0.5;
  }

  /**
   * 提取域名
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  /**
   * 检查是否为高质量域名
   */
  isHighQualityDomain(domain) {
    // 检查是否在高质量列表中
    for (const highQualityDomain of HIGH_QUALITY_DOMAINS) {
      if (domain.endsWith(highQualityDomain)) {
        return true;
      }
    }
    
    // 检查声誉历史
    const reputation = this.domainReputation.get(domain);
    if (reputation !== undefined) {
      return reputation >= 0.7;
    }
    
    return false;
  }

  /**
   * 计算总体质量分数
   */
  calculateQualityScore(results) {
    if (results.length === 0) return 0;
    
    const avgScore = results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length;
    const avgVerification = results.reduce((sum, r) => 
      sum + (r.verificationScore || r.score), 0) / results.length;
    
    return (avgScore + avgVerification) / 2;
  }

  /**
   * 构建深度搜索查询
   */
  constructDeepSearchQuery(topic, depth, accumulatedKnowledge) {
    const prefixes = ['', '深入了解', '详细分析', '实证研究', '最新进展'];
    const prefixesZh = ['', '深入了解', '详细分析', '实证研究', '最新进展'];
    
    if (depth === 0) {
      return `${topic} 概述和基础知识`;
    } else if (depth === 1) {
      return `${topic} ${prefixesZh[1]}`;
    } else if (depth === 2) {
      return `${topic} ${prefixesZh[2]}和具体案例`;
    } else {
      return `${topic} ${prefixesZh[3]}`;
    }
  }

  /**
   * 提取洞察
   */
  extractInsights(results) {
    return results
      .filter(r => r.score > 0.8)
      .map(r => ({
        title: r.title,
        url: r.url,
        keyPoint: this.extractKeyPoint(r.content)
      }));
  }

  /**
   * 提取关键点
   */
  extractKeyPoint(content) {
    // 简化实现：取第一句话
    const sentences = content.split(/[。！？.!?]/);
    return sentences[0]?.trim() || content.substring(0, 100);
  }

  /**
   * 累积知识
   */
  accumulateKnowledge(current, newResults) {
    const newKnowledge = newResults
      .filter(r => r.score > 0.8)
      .map(r => ({
        title: r.title,
        url: r.url,
        content: r.content
      }));
    
    return [...current, ...newKnowledge];
  }

  /**
   * 生成研究报告
   */
  generateResearchReport(steps, topic) {
    const report = {
      title: `${topic} 深度研究报告`,
      summary: '',
      keyFindings: [],
      sources: [],
      recommendations: []
    };
    
    // 生成摘要
    report.summary = `通过 ${steps.length} 轮深度搜索，共收集 ${steps.reduce((sum, s) => sum + s.results.length, 0)} 个来源的信息。`;
    
    // 提取关键发现
    steps.forEach(step => {
      step.insights.forEach(insight => {
        if (!report.keyFindings.find(f => f.url === insight.url)) {
          report.keyFindings.push(insight);
        }
      });
    });
    
    // 收集所有来源
    steps.forEach(step => {
      step.results.forEach(result => {
        if (!report.sources.find(s => s.url === result.url)) {
          report.sources.push({
            title: result.title,
            url: result.url,
            score: result.score
          });
        }
      });
    });
    
    return report;
  }

  /**
   * 记录搜索日志
   */
  logSearch(logEntry) {
    this.searchLedger.push(logEntry);
  }

  /**
   * 获取搜索日志
   */
  getSearchLog() {
    return this.searchLedger;
  }

  /**
   * 降级搜索（使用传统 WebSearch）
   */
  async fallbackSearch(query, context) {
    console.log(`[降级搜索] 使用传统搜索: "${query}"`);
    
    return {
      success: true,
      results: [], // 实际应调用传统搜索 API
      query,
      metadata: {
        source: 'web_search_fallback',
        qualityScore: 0.5,
        crossVerified: false,
        fallbackUsed: true
      }
    };
  }

  /**
   * 保存搜索账本
   */
  async saveSearchLedger(outputPath) {
    const ledger = {
      version: 1,
      generatedAt: new Date().toISOString(),
      config: this.config,
      searches: this.searchLedger
    };
    
    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(ledger, null, 2),
      'utf8'
    );
  }

  /**
   * 加载搜索账本
   */
  async loadSearchLedger(inputPath) {
    try {
      const content = await fs.promises.readFile(inputPath, 'utf8');
      const ledger = JSON.parse(content);
      
      this.searchLedger = ledger.searches || [];
      
      // 更新域名声誉
      this.updateDomainReputation(ledger);
      
      return ledger;
    } catch (error) {
      console.error('加载搜索账本失败:', error.message);
      return null;
    }
  }

  /**
   * 更新域名声誉
   */
  updateDomainReputation(ledger) {
    ledger.searches.forEach(search => {
      search.results?.forEach(result => {
        const domain = this.extractDomain(result.url);
        const currentScore = this.domainReputation.get(domain) || 0.5;
        const newScore = currentScore * 0.9 + (result.score || 0.5) * 0.1;
        this.domainReputation.set(domain, newScore);
      });
    });
  }
}

/**
 * CLI 入口
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args.includes('--help')) {
    console.log(`
Exa 神经搜索增强器

用法:
  node exa-search-enhancer.mjs <action> <query> [options]

动作:
  search        执行语义搜索
  deep-research  执行深度研究
  log           查看搜索日志
  export        导出搜索账本

参数:
  query         搜索查询词
  depth         深度研究的层级 (默认: 3)

选项:
  --config       配置文件路径 (JSON 格式)
  --output       输出文件路径
  --num-results  返回结果数量 (默认: 10)
  --type         搜索类型: auto, fast, deep (默认: auto)
  --no-fallback  禁用降级搜索
  --no-verify   禁用交叉验证
  --json         以 JSON 格式输出
  --help         显示帮助信息

示例:
  # 语义搜索
  node exa-search-enhancer.mjs search "人工智能最新进展"
  
  # 深度研究
  node exa-search-enhancer.mjs deep-research "区块链技术" --depth 3
  
  # 带配置的搜索
  node exa-search-enhancer.mjs search "气候变化" --config config.json
  
  # 导出搜索账本
  node exa-search-enhancer.mjs log --output search-ledger.jsonl
    `);
    process.exit(0);
  }
  
  const action = args[0];
  const query = args[1];
  const options = parseArgs(args.slice(2));
  
  try {
    // 加载配置
    let config = {};
    if (options.config) {
      const configContent = fs.readFileSync(options.config, 'utf8');
      config = JSON.parse(configContent);
    }
    
    // 创建增强器实例
    const enhancer = new ExaSearchEnhancer(config);
    
    switch (action) {
      case 'search':
        const searchResult = await enhancer.semanticSearch(query, {}, {
          numResults: options.numResults,
          type: options.type
        });
        
        if (options.json) {
          console.log(JSON.stringify(searchResult, null, 2));
        } else {
          printSearchResult(searchResult);
        }
        break;
        
      case 'deep-research':
        const depth = parseInt(options.depth) || 3;
        const researchResult = await enhancer.deepResearch(query, depth);
        
        if (options.json) {
          console.log(JSON.stringify(researchResult, null, 2));
        } else {
          printResearchResult(researchResult);
        }
        break;
        
      case 'log':
        const log = enhancer.getSearchLog();
        if (options.output) {
          await enhancer.saveSearchLedger(options.output);
          console.log(`搜索日志已保存到: ${options.output}`);
        } else {
          console.log(JSON.stringify(log, null, 2));
        }
        break;
        
      default:
        console.error(`未知动作: ${action}`);
        process.exit(1);
    }
    
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const options = {
    config: null,
    output: null,
    numResults: 10,
    type: 'auto',
    noFallback: false,
    noVerify: false,
    json: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--config' && args[i + 1]) {
      options.config = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--num-results' && args[i + 1]) {
      options.numResults = parseInt(args[++i]);
    } else if (arg.startsWith('--type=')) {
      options.type = arg.split('=')[1];
    } else if (arg === '--no-fallback') {
      options.noFallback = true;
    } else if (arg === '--no-verify') {
      options.noVerify = true;
    } else if (arg === '--json') {
      options.json = true;
    }
  }
  
  return options;
}

/**
 * 打印搜索结果
 */
function printSearchResult(result) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Exa 语义搜索结果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`查询: ${result.query}`);
  console.log(`来源: ${result.metadata.source}`);
  console.log(`质量分数: ${result.metadata.qualityScore.toFixed(2)}`);
  console.log(`交叉验证: ${result.metadata.crossVerified ? '✅' : '❌'}`);
  
  if (result.results.length > 0) {
    console.log(`\n找到 ${result.results.length} 个结果:\n`);
    
    result.results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.title}`);
      console.log(`   URL: ${r.url}`);
      console.log(`   分数: ${r.score.toFixed(2)}`);
      console.log(`   摘要: ${r.content.substring(0, 100)}...`);
      console.log('');
    });
  } else {
    console.log('\n未找到结果');
  }
}

/**
 * 打印研究结果
 */
function printResearchResult(result) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('深度研究报告');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`主题: ${result.topic}`);
  console.log(`深度: ${result.depth} 层`);
  console.log(`总查询数: ${result.metadata.totalQueries}`);
  console.log(`总结果数: ${result.metadata.totalResults}`);
  
  console.log('\n摘要:');
  console.log(result.report.summary);
  
  console.log('\n关键发现:');
  result.report.keyFindings.forEach((finding, i) => {
    console.log(`  ${i + 1}. ${finding.title}`);
    console.log(`     ${finding.keyPoint}`);
  });
  
  console.log('\n推荐行动:');
  result.report.sources.slice(0, 3).forEach((source, i) => {
    console.log(`  ${i + 1}. ${source.title}`);
  });
}
