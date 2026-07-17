#!/usr/bin/env node
/**
 * 智能模板推荐系统
 * 
 * 功能:
 * - 基于用户历史推荐模板
 * - 多维度评分（体裁、字数、风格、使用频率）
 * - 冷启动推荐
 * - 模板发现与探索
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 模板数据库
 */
const TEMPLATE_DATABASE = [
  // 白皮书类
  {
    id: 'whitepaper-industry',
    name: '行业白皮书',
    genres: ['白皮书', '行业报告', '研究报告'],
    lengthRange: { min: 50000, max: 200000 },
    style: '正式权威',
    structure: ['引言', '市场分析', '技术方案', '案例分析', '结论与建议'],
    audience: '企业管理者',
    tags: ['B2B', '专业', '数据驱动']
  },
  {
    id: 'whitepaper-technology',
    name: '技术白皮书',
    genres: ['白皮书', '技术文档'],
    lengthRange: { min: 30000, max: 100000 },
    style: '技术专业',
    structure: ['背景', '技术架构', '实现方案', '优势分析', '应用场景'],
    audience: '技术决策者',
    tags: ['技术', '架构', '解决方案']
  },
  
  // 手册类
  {
    id: 'manual-employee',
    name: '员工手册',
    genres: ['手册', '员工指南', '操作手册'],
    lengthRange: { min: 20000, max: 80000 },
    style: '清晰实用',
    structure: ['公司文化', '规章制度', '工作流程', '福利待遇', '常见问题'],
    audience: '新员工',
    tags: ['内部', '实用', '流程化']
  },
  {
    id: 'manual-product',
    name: '产品使用手册',
    genres: ['手册', '用户指南', '产品文档'],
    lengthRange: { min: 15000, max: 50000 },
    style: '简洁友好',
    structure: ['产品介绍', '快速开始', '功能详解', '常见问题', '联系支持'],
    audience: '产品用户',
    tags: ['用户友好', '操作指导', 'FAQ']
  },
  {
    id: 'manual-training',
    name: '培训手册',
    genres: ['手册', '培训资料', '学习指南'],
    lengthRange: { min: 30000, max: 100000 },
    style: '循序渐进',
    structure: ['课程大纲', '模块详解', '练习作业', '考核评估', '参考资料'],
    audience: '培训学员',
    tags: ['教育', '培训', '实践']
  },
  
  // 指南类
  {
    id: 'guide-entry',
    name: '入门指南',
    genres: ['指南', '入门', '新手教程'],
    lengthRange: { min: 20000, max: 60000 },
    style: '亲切易懂',
    structure: ['准备工作', '基础概念', '快速上手', '进阶技巧', '资源推荐'],
    audience: '初学者',
    tags: ['入门', '易懂', '循序渐进']
  },
  {
    id: 'guide-best-practices',
    name: '最佳实践指南',
    genres: ['指南', '最佳实践', '经验总结'],
    lengthRange: { min: 30000, max: 100000 },
    style: '专业实用',
    structure: ['问题背景', '实践原则', '具体方法', '案例分析', '总结清单'],
    audience: '专业从业者',
    tags: ['专业', '实用', '案例驱动']
  },
  
  // 报道类
  {
    id: 'report-in-depth',
    name: '深度报道',
    genres: ['报道', '深度稿', '特稿', '调查报道'],
    lengthRange: { min: 8000, max: 30000 },
    style: '深度客观',
    structure: ['导语', '核心事件', '多方观点', '背景分析', '影响与展望'],
    audience: '关注相关议题的读者',
    tags: ['深度', '客观', '多角度']
  },
  {
    id: 'report-feature',
    name: '专题报道',
    genres: ['报道', '专题', '长文'],
    lengthRange: { min: 5000, max: 20000 },
    style: '叙事性强',
    structure: ['引入', '故事展开', '人物访谈', '问题探讨', '开放式结尾'],
    audience: '大众读者',
    tags: ['叙事', '人物', '故事化']
  },
  
  // 书籍类
  {
    id: 'book-knowledge',
    name: '知识类书籍',
    genres: ['书籍', '知识产品'],
    lengthRange: { min: 80000, max: 300000 },
    style: '系统完整',
    structure: ['引言', '核心理论', '实践应用', '案例分析', '总结与延伸'],
    audience: '专业学习者',
    tags: ['系统', '完整', '理论与实践结合']
  },
  {
    id: 'book-popular',
    name: '普及类书籍',
    genres: ['书籍', '科普读物'],
    lengthRange: { min: 60000, max: 200000 },
    style: '通俗易懂',
    structure: ['吸引人的开头', '深入浅出的讲解', '生活化的例子', '有趣的结尾'],
    audience: '大众读者',
    tags: ['科普', '有趣', '生活化']
  }
];

/**
 * 模板推荐器类
 */
export class TemplateRecommender {
  constructor(userProfile, history) {
    this.profile = userProfile || {};
    this.history = history || { projects: [], styles: [] };
    this.templates = TEMPLATE_DATABASE;
    this.scoreWeights = {
      genreMatch: 0.35,
      lengthMatch: 0.25,
      styleMatch: 0.20,
      recentUsage: 0.10,
      diversityBonus: 0.10
    };
  }

  /**
   * 推荐 Top-N 模板
   */
  recommend(context, topN = 3) {
    const scored = this.templates.map(template => {
      const score = this.calculateScore(template, context);
      return {
        ...template,
        recommendationScore: score,
        reasons: this.generateReasons(template, context)
      };
    });
    
    // 按分数排序
    scored.sort((a, b) => b.recommendationScore - a.recommendationScore);
    
    return scored.slice(0, topN);
  }

  /**
   * 计算模板推荐分数
   */
  calculateScore(template, context) {
    let score = 0;
    const reasons = [];
    
    // 1. 体裁匹配
    if (context.genre && template.genres.includes(context.genre)) {
      score += this.scoreWeights.genreMatch;
      reasons.push('体裁匹配');
    }
    
    // 2. 字数范围匹配
    if (context.targetLength) {
      const inRange = this.isInRange(context.targetLength, template.lengthRange);
      if (inRange) {
        score += this.scoreWeights.lengthMatch;
        reasons.push('字数范围匹配');
      }
    }
    
    // 3. 风格匹配（基于用户历史）
    if (this.history.styles.length > 0) {
      const userStyle = this.inferStyleFromHistory();
      if (template.style === userStyle) {
        score += this.scoreWeights.styleMatch;
        reasons.push('风格匹配历史偏好');
      }
    }
    
    // 4. 最近使用频率
    const recentUseCount = this.getRecentUsage(template.id);
    if (recentUseCount > 0) {
      const recentScore = Math.min(recentUseCount / 5, 1) * this.scoreWeights.recentUsage;
      score += recentScore;
      if (recentScore > 0) {
        reasons.push(`近期使用 ${recentUseCount} 次`);
      }
    }
    
    // 5. 多样性奖励（偶尔推荐不同风格）
    if (this.shouldEncourageDiversity(template)) {
      score += this.scoreWeights.diversityBonus;
      reasons.push('探索新风格');
    }
    
    // 6. 目标读者匹配
    if (context.audience && template.audience === context.audience) {
      score += 0.05; // 小额奖励
      reasons.push('目标读者匹配');
    }
    
    // 7. 标签匹配
    if (context.tags && context.tags.length > 0) {
      const tagMatches = template.tags.filter(tag => context.tags.includes(tag)).length;
      if (tagMatches > 0) {
        score += tagMatches * 0.02;
        reasons.push(`匹配 ${tagMatches} 个标签`);
      }
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * 检查字数是否在范围内
   */
  isInRange(targetLength, range) {
    return targetLength >= range.min && targetLength <= range.max;
  }

  /**
   * 从历史推断风格
   */
  inferStyleFromHistory() {
    if (this.history.styles.length === 0) {
      return '';
    }
    
    // 统计最常出现的风格
    const styleCount = {};
    this.history.styles.forEach(style => {
      styleCount[style] = (styleCount[style] || 0) + 1;
    });
    
    return Object.entries(styleCount)
      .sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * 获取最近使用次数
   */
  getRecentUsage(templateId) {
    const recentProjects = this.history.projects
      .filter(p => this.isRecent(p.timestamp))
      .filter(p => p.templateId === templateId);
    
    return recentProjects.length;
  }

  /**
   * 判断是否为最近的项目
   */
  isRecent(timestamp) {
    if (!timestamp) return false;
    const projectDate = new Date(timestamp);
    const now = new Date();
    const daysSince = (now - projectDate) / (24 * 60 * 60 * 1000);
    return daysSince <= 30; // 30天内
  }

  /**
   * 判断是否应该鼓励多样性
   */
  shouldEncourageDiversity(template) {
    if (this.history.projects.length === 0) {
      return false;
    }
    
    // 计算最近项目的风格多样性
    const recentStyles = this.history.projects
      .filter(p => this.isRecent(p.timestamp))
      .map(p => p.style);
    
    const uniqueStyles = new Set(recentStyles);
    
    // 如果最近用的都是一种风格，鼓励尝试新的
    if (uniqueStyles.size === 1 && !uniqueStyles.has(template.style)) {
      return true;
    }
    
    return false;
  }

  /**
   * 生成推荐理由
   */
  generateReasons(template, context) {
    const reasons = [];
    
    if (context.genre && template.genres.includes(context.genre)) {
      reasons.push(`体裁匹配：${context.genre}`);
    }
    
    if (context.targetLength && this.isInRange(context.targetLength, template.lengthRange)) {
      reasons.push(`字数范围：${template.lengthRange.min.toLocaleString()}-${template.lengthRange.max.toLocaleString()}字`);
    }
    
    if (this.history.styles.length > 0) {
      const userStyle = this.inferStyleFromHistory();
      if (template.style === userStyle) {
        reasons.push(`风格符合您的偏好：${template.style}`);
      }
    }
    
    const recentUseCount = this.getRecentUsage(template.id);
    if (recentUseCount > 0) {
      reasons.push(`您最近用过 ${recentUseCount} 次`);
    }
    
    return reasons;
  }

  /**
   * 冷启动推荐（无历史数据时）
   */
  recommendForColdStart() {
    // 推荐最通用、最受欢迎的模板
    const popularityScore = template => {
      let score = 0;
      
      // 通用性：适用的体裁多
      score += template.genres.length * 0.2;
      
      // 字数范围：范围适中
      const rangeSpan = template.lengthRange.max - template.lengthRange.min;
      score += (1 - rangeSpan / 200000) * 0.3;
      
      // 风格友好：入门友好、通俗易懂
      if (['通俗易懂', '简洁友好', '亲切易懂'].includes(template.style)) {
        score += 0.3;
      }
      
      return score;
    };
    
    const scored = this.templates.map(t => ({
      ...t,
      coldStartScore: popularityScore(t)
    }));
    
    scored.sort((a, b) => b.coldStartScore - a.coldStartScore);
    
    return scored.slice(0, 3);
  }

  /**
   * 基于关键词搜索模板
   */
  searchByKeywords(keywords) {
    const keywordList = Array.isArray(keywords) ? keywords : keywords.split(/\s+/);
    
    return this.templates
      .filter(template => {
        // 检查名称
        const nameMatch = keywordList.some(kw => 
          template.name.toLowerCase().includes(kw.toLowerCase())
        );
        
        // 检查体裁
        const genreMatch = keywordList.some(kw =>
          template.genres.some(g => g.toLowerCase().includes(kw.toLowerCase()))
        );
        
        // 检查标签
        const tagMatch = keywordList.some(kw =>
          template.tags.some(t => t.toLowerCase().includes(kw.toLowerCase()))
        );
        
        return nameMatch || genreMatch || tagMatch;
      })
      .map(template => ({
        ...template,
        matchReason: this.getMatchReason(template, keywordList)
      }));
  }

  /**
   * 获取匹配原因
   */
  getMatchReason(template, keywords) {
    const reasons = [];
    
    keywords.forEach(kw => {
      if (template.name.toLowerCase().includes(kw.toLowerCase())) {
        reasons.push(`名称包含"${kw}"`);
      } else if (template.genres.some(g => g.toLowerCase().includes(kw.toLowerCase()))) {
        reasons.push(`体裁包含"${kw}"`);
      } else if (template.tags.some(t => t.toLowerCase().includes(kw.toLowerCase()))) {
        reasons.push(`标签包含"${kw}"`);
      }
    });
    
    return [...new Set(reasons)].join(', ');
  }

  /**
   * 按体裁过滤模板
   */
  filterByGenre(genre) {
    return this.templates.filter(template =>
      template.genres.includes(genre)
    );
  }

  /**
   * 按字数范围过滤模板
   */
  filterByLength(targetLength) {
    return this.templates.filter(template =>
      this.isInRange(targetLength, template.lengthRange)
    );
  }

  /**
   * 记录模板使用
   */
  recordUsage(templateId, metadata = {}) {
    const usage = {
      templateId,
      timestamp: new Date().toISOString(),
      ...metadata
    };
    
    this.history.projects.push(usage);
    
    // 更新风格历史
    const template = this.templates.find(t => t.id === templateId);
    if (template) {
      this.history.styles.push(template.style);
    }
    
    return {
      success: true,
      usage,
      template
    };
  }

  /**
   * 获取用户偏好画像
   */
  getUserPreferences() {
    if (this.history.projects.length === 0) {
      return {
        hasHistory: false,
        message: '暂无使用历史，建议尝试热门模板'
      };
    }
    
    // 分析用户偏好
    const preferences = {
      hasHistory: true,
      favoriteGenres: this.getFavoriteGenres(),
      favoriteStyles: this.getFavoriteStyles(),
      averageLength: this.getAverageLength(),
      usagePatterns: this.getUsagePatterns()
    };
    
    return preferences;
  }

  /**
   * 获取偏好的体裁
   */
  getFavoriteGenres() {
    const genreCount = {};
    
    this.history.projects.forEach(project => {
      const template = this.templates.find(t => t.id === project.templateId);
      if (template) {
        template.genres.forEach(genre => {
          genreCount[genre] = (genreCount[genre] || 0) + 1;
        });
      }
    });
    
    return Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre, count]) => ({ genre, count }));
  }

  /**
   * 获取偏好的风格
   */
  getFavoriteStyles() {
    const styleCount = {};
    
    this.history.styles.forEach(style => {
      styleCount[style] = (styleCount[style] || 0) + 1;
    });
    
    return Object.entries(styleCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([style, count]) => ({ style, count }));
  }

  /**
   * 获取平均字数
   */
  getAverageLength() {
    const lengths = this.history.projects
      .filter(p => p.targetLength)
      .map(p => p.targetLength);
    
    if (lengths.length === 0) return null;
    
    const sum = lengths.reduce((a, b) => a + b, 0);
    return Math.round(sum / lengths.length);
  }

  /**
   * 获取使用模式
   */
  getUsagePatterns() {
    if (this.history.projects.length === 0) return null;
    
    // 按月统计
    const monthlyUsage = {};
    this.history.projects.forEach(project => {
      const month = new Date(project.timestamp).toISOString().substring(0, 7);
      monthlyUsage[month] = (monthlyUsage[month] || 0) + 1;
    });
    
    // 最近7天使用次数
    const recent7Days = this.history.projects.filter(p => {
      const daysSince = (new Date() - new Date(p.timestamp)) / (24 * 60 * 60 * 1000);
      return daysSince <= 7;
    }).length;
    
    return {
      monthlyUsage,
      recent7Days,
      totalProjects: this.history.projects.length
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
智能模板推荐系统

用法:
  node template-recommender.mjs <action> [options]

动作:
  recommend       推荐模板
  search          按关键词搜索模板
  list-templates  列出所有模板
  preferences     查看用户偏好
  record          记录模板使用

参数:
  genre           目标体裁 (白皮书、手册、指南、报道、书籍)
  target-length   目标字数
  audience        目标读者
  tags            标签列表 (逗号分隔)
  keywords        搜索关键词 (空格分隔)

选项:
  --top-n         返回前 N 个推荐 (默认: 3)
  --template-id    模板 ID (用于 record)
  --metadata       额外元数据 (JSON 字符串)
  --json           以 JSON 格式输出
  --help           显示帮助信息

示例:
  # 基于上下文推荐
  node template-recommender.mjs recommend --genre 白皮书 --target-length 50000 --audience 企业管理者
  
  # 搜索模板
  node template-recommender.mjs search "技术 白皮书"
  
  # 列出所有模板
  node template-recommender.mjs list-templates
  
  # 查看用户偏好
  node template-recommender.mjs preferences
  
  # 记录模板使用
  node template-recommender.mjs record --template-id whitepaper-industry
    `);
    process.exit(0);
  }
  
  const action = args[0];
  const options = parseArgs(args.slice(1));
  
  try {
    const recommender = new TemplateRecommender({}, { projects: [], styles: [] });
    
    switch (action) {
      case 'recommend': {
        const context = {
          genre: options.genre,
          targetLength: options.targetLength ? parseInt(options.targetLength) : null,
          audience: options.audience,
          tags: options.tags
        };
        
        const recommendations = recommender.recommend(context, options.topN);
        
        if (options.json) {
          console.log(JSON.stringify(recommendations, null, 2));
        } else {
          printRecommendations(recommendations, context);
        }
        break;
      }
        
      case 'search': {
        const keywords = options.keywords;
        if (!keywords) {
          console.error('错误: 请提供搜索关键词');
          process.exit(1);
        }
        
        const results = recommender.searchByKeywords(keywords);
        
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          printSearchResults(results, keywords);
        }
        break;
      }
        
      case 'list-templates': {
        if (options.json) {
          console.log(JSON.stringify(TEMPLATE_DATABASE, null, 2));
        } else {
          printAllTemplates(TEMPLATE_DATABASE);
        }
        break;
      }
        
      case 'preferences': {
        const preferences = recommender.getUserPreferences();
        
        if (options.json) {
          console.log(JSON.stringify(preferences, null, 2));
        } else {
          printPreferences(preferences);
        }
        break;
      }
        
      case 'record': {
        if (!options.templateId) {
          console.error('错误: 请提供模板 ID (--template-id)');
          process.exit(1);
        }
        
        const metadata = options.metadata ? JSON.parse(options.metadata) : {};
        const result = recommender.recordUsage(options.templateId, metadata);
        
        console.log('使用记录已保存');
        console.log('模板:', result.template.name);
        console.log('时间:', result.usage.timestamp);
        break;
      }
        
      default:
        console.error('未知动作:', action);
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
    topN: 3,
    templateId: null,
    metadata: null,
    json: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--top-n' && args[i + 1]) {
      options.topN = parseInt(args[++i]);
    } else if (arg === '--template-id' && args[i + 1]) {
      options.templateId = args[++i];
    } else if (arg === '--metadata' && args[i + 1]) {
      options.metadata = args[++i];
    } else if (arg.startsWith('--genre=')) {
      options.genre = arg.split('=')[1];
    } else if (arg.startsWith('--target-length=')) {
      options.targetLength = arg.split('=')[1];
    } else if (arg.startsWith('--audience=')) {
      options.audience = arg.split('=')[1];
    } else if (arg.startsWith('--tags=')) {
      options.tags = arg.split('=')[1].split(',').map(t => t.trim());
    } else if (arg.startsWith('--keywords=')) {
      options.keywords = arg.split('=')[1];
    } else if (arg === '--json') {
      options.json = true;
    }
  }
  
  return options;
}

/**
 * 打印推荐结果
 */
function printRecommendations(recommendations, context) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('模板推荐');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (context.genre) console.log(`体裁: ${context.genre}`);
  if (context.targetLength) console.log(`目标字数: ${context.targetLength.toLocaleString()}字`);
  if (context.audience) console.log(`目标读者: ${context.audience}`);
  
  console.log('\n推荐结果:\n');
  
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec.name} (分数: ${rec.recommendationScore.toFixed(2)})`);
    console.log(`   体裁: ${rec.genres.join(', ')}`);
    console.log(`   字数范围: ${rec.lengthRange.min.toLocaleString()}-${rec.lengthRange.max.toLocaleString()}字`);
    console.log(`   风格: ${rec.style}`);
    console.log(`   目标读者: ${rec.audience}`);
    console.log(`   结构: ${rec.structure.join(' → ')}`);
    
    if (rec.reasons && rec.reasons.length > 0) {
      console.log(`   推荐理由: ${rec.reasons.join('；')}`);
    }
    
    console.log('');
  });
}

/**
 * 打印搜索结果
 */
function printSearchResults(results, keywords) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('模板搜索结果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`关键词: ${keywords}\n`);
  
  if (results.length === 0) {
    console.log('未找到匹配的模板');
    return;
  }
  
  results.forEach((result, i) => {
    console.log(`${i + 1}. ${result.name}`);
    console.log(`   ID: ${result.id}`);
    console.log(`   体裁: ${result.genres.join(', ')}`);
    console.log(`   字数范围: ${result.lengthRange.min.toLocaleString()}-${result.lengthRange.max.toLocaleString()}字`);
    console.log(`   匹配原因: ${result.matchReason}`);
    console.log('');
  });
}

/**
 * 打印所有模板
 */
function printAllTemplates(templates) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('模板库');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  templates.forEach((template, i) => {
    console.log(`${i + 1}. ${template.name}`);
    console.log(`   ID: ${template.id}`);
    console.log(`   体裁: ${template.genres.join(', ')}`);
    console.log(`   字数范围: ${template.lengthRange.min.toLocaleString()}-${template.lengthRange.max.toLocaleString()}字`);
    console.log(`   风格: ${template.style}`);
    console.log(`   目标读者: ${template.audience}`);
    console.log(`   结构: ${template.structure.join(' → ')}`);
    console.log(`   标签: ${template.tags.join(', ')}`);
    console.log('');
  });
}

/**
 * 打印用户偏好
 */
function printPreferences(preferences) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('用户偏好画像');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (!preferences.hasHistory) {
    console.log(preferences.message);
    return;
  }
  
  console.log('偏好的体裁:');
  preferences.favoriteGenres.forEach(({ genre, count }) => {
    console.log(`  - ${genre} (${count}次)`);
  });
  
  console.log('\n偏好的风格:');
  preferences.favoriteStyles.forEach(({ style, count }) => {
    console.log(`  - ${style} (${count}次)`);
  });
  
  if (preferences.averageLength) {
    console.log(`\n平均字数: ${preferences.averageLength.toLocaleString()}字`);
  }
  
  if (preferences.usagePatterns) {
    console.log('\n使用模式:');
    console.log(`  总项目数: ${preferences.usagePatterns.totalProjects}`);
    console.log(`  最近7天: ${preferences.usagePatterns.recent7Days}次`);
  }
}
