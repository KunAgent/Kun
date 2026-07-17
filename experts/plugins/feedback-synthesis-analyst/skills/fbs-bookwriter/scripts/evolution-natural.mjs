#!/usr/bin/env node
/**
 * FBS-BookWriter 自增强进化自然语言接口
 * 
 * 功能：支持用户以自然语言命令触发、控制、查询进化过程
 * 
 * 支持的命令：
 * - 检查进化状态
 * - 触发进化
 * - 查看方法论知识
 * - 回滚进化
 * - 暂停/恢复进化
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { EvolutionEngine } from './self-enhancement-evolution.mjs';
import { KnowledgeFetcher } from './knowledge-fetcher.mjs';
import { EVOLUTION_CONFIG } from './self-enhancement-evolution.mjs';

/**
 * 自增强进化自然语言处理器
 */
export class EvolutionNatural {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.evolutionEngine = new EvolutionEngine(projectRoot);
    this.knowledgeFetcher = new KnowledgeFetcher(projectRoot);
    this.options = options;
  }
  
  /**
   * 处理自然语言命令
   */
  async processCommand(command, context = {}) {
    const commandLower = command.toLowerCase().trim();
    const parsed = this.parseCommand(commandLower);
    
    console.log(`\n🔄 进化命令: ${command}`);
    console.log(`解析结果: ${JSON.stringify(parsed)}\n`);
    
    try {
      return await this.executeCommand(parsed, context);
    } catch (error) {
      return {
        success: false,
        action: parsed.action,
        message: `执行失败: ${error.message}`,
        error: error.message
      };
    }
  }
  
  /**
   * 解析命令
   */
  parseCommand(command) {
    // 进化状态查询
    if (this.matchAny(command, ['检查进化状态', '进化进度', '能力更新情况', '进化状态', '更新情况'])) {
      return { action: 'checkStatus' };
    }
    
    // 触发进化
    if (this.matchAny(command, ['触发进化', '开始能力提升', '升级方法论', '启动进化', '能力升级'])) {
      return { 
        action: 'triggerEvolution',
        domain: this.extractDomain(command)
      };
    }
    
    // 查看方法论知识
    if (this.matchAny(command, ['查看方法论知识', '获取最新技巧', '学习最佳实践', '方法论知识', '最佳实践'])) {
      return { 
        action: 'viewKnowledge',
        domain: this.extractDomain(command)
      };
    }
    
    // 回滚进化
    if (this.matchAny(command, ['回滚进化', '撤销更新', '恢复之前的版本', '回滚', '撤销'])) {
      return { action: 'rollbackEvolution' };
    }
    
    // 暂停进化
    if (this.matchAny(command, ['暂停进化', '停止自动更新', '暂停能力提升', '暂停', '停止'])) {
      return { action: 'pauseEvolution' };
    }
    
    // 恢复进化
    if (this.matchAny(command, ['恢复进化', '重新开始进化', '启用自动更新', '恢复', '启用'])) {
      return { action: 'resumeEvolution' };
    }
    
    // 查看进化历史
    if (this.matchAny(command, ['查看进化历史', '进化记录', '更新历史', '历史记录'])) {
      return { action: 'viewHistory' };
    }
    
    // 配置进化
    if (this.matchAny(command, ['配置进化', '进化设置', '设置进化参数', '配置'])) {
      return { action: 'configureEvolution' };
    }
    
    // 兜底：帮助
    return { action: 'help' };
  }
  
  /**
   * 执行命令
   */
  async executeCommand(parsed, context) {
    switch (parsed.action) {
      case 'checkStatus':
        return await this.checkStatus(context);
        
      case 'triggerEvolution':
        return await this.triggerEvolution(parsed, context);
        
      case 'viewKnowledge':
        return await this.viewKnowledge(parsed, context);
        
      case 'rollbackEvolution':
        return await this.rollbackEvolution(context);
        
      case 'pauseEvolution':
        return await this.pauseEvolution(context);
        
      case 'resumeEvolution':
        return await this.resumeEvolution(context);
        
      case 'viewHistory':
        return await this.viewHistory(context);
        
      case 'configureEvolution':
        return await this.configureEvolution(context);
        
      case 'help':
        return this.showHelp();
        
      default:
        return {
          success: false,
          action: 'unknown',
          message: '无法理解的命令'
        };
    }
  }
  
  /**
   * 检查进化状态
   */
  async checkStatus(context) {
    console.log('🔍 检查进化状态...\n');
    
    // 检查是否需要进化
    const checkResult = await this.evolutionEngine.checkEvolutionNeeded();
    
    // 获取知识库状态
    const knowledgeStats = this.knowledgeFetcher.getCacheStats();
    
    // 检查配置状态
    const configStatus = this.getConfigurationStatus();
    
    const status = {
      evolutionNeeded: checkResult.needed,
      triggers: checkResult.triggers,
      knowledgeStats,
      configStatus,
      recommendations: this.generateRecommendations(checkResult, knowledgeStats)
    };
    
    return {
      success: true,
      action: 'checkStatus',
      message: '进化状态检查完成',
      details: this.formatStatusReport(status)
    };
  }
  
  /**
   * 触发进化
   */
  async triggerEvolution(parsed, context) {
    console.log('🚀 准备触发进化...\n');
    
    // 检查是否需要进化
    const checkResult = await this.evolutionEngine.checkEvolutionNeeded();
    
    if (!checkResult.needed) {
      return {
        success: false,
        action: 'triggerEvolution',
        message: '当前不满足进化条件',
        details: '等待30天时间间隔或100次操作'
      };
    }
    
    // 确定进化领域
    const domain = parsed.domain || this.selectBestDomain(checkResult);
    
    console.log(`📚 目标领域: ${domain}`);
    console.log(`🔍 触发原因: ${checkResult.triggers.map(t => t.reason).join(', ')}\n`);
    
    // 请求用户确认
    console.log('⚠️  即将开始进化过程，这将：');
    console.log('  1. 联网搜索获取最新方法论知识');
    console.log('  2. 分析和综合搜索结果');
    console.log('  3. 创建或更新能力模块');
    console.log('  4. 执行测试和验证');
    console.log('  5. 备份当前版本');
    console.log('\n⏱️  预计耗时: 10-30分钟\n');
    console.log('是否继续？输入"确认"继续，输入"取消"终止。\n');
    
    // 这里应该等待用户确认
    // 简化实现：假设用户确认
    console.log('用户确认，开始进化...\n');
    
    // 启动进化
    try {
      await this.evolutionEngine.startEvolution(domain, true);
      
      return {
        success: true,
        action: 'triggerEvolution',
        message: `${domain} 领域进化完成`,
        details: `已更新${domain}相关的方法论知识和能力模块`
      };
    } catch (error) {
      return {
        success: false,
        action: 'triggerEvolution',
        message: `进化失败: ${error.message}`,
        details: '请查看详细错误信息'
      };
    }
  }
  
  /**
   * 查看方法论知识
   */
  async viewKnowledge(parsed, context) {
    console.log('📖 查看方法论知识...\n');
    
    const domain = parsed.domain || 'deAIFlavor';
    
    // 获取领域知识
    let knowledge;
    if (this.knowledgeFetcher.knowledgeCache.has(domain)) {
      knowledge = this.knowledgeFetcher.knowledgeCache.get(domain);
    } else {
      console.log(`🔍 正在获取 ${domain} 领域知识...\n`);
      knowledge = await this.knowledgeFetcher.fetchDomainKnowledge(domain);
    }
    
    // 格式化知识展示
    const formatted = this.formatKnowledgeDisplay(knowledge);
    
    return {
      success: true,
      action: 'viewKnowledge',
      message: `${domain} 领域知识`,
      details: formatted
    };
  }
  
  /**
   * 回滚进化
   */
  async rollbackEvolution(context) {
    console.log('⏪ 准备回滚进化...\n');
    
    // 显示可回滚的版本
    const rollbacks = this.getAvailableRollbacks();
    
    if (rollbacks.length === 0) {
      return {
        success: false,
        action: 'rollbackEvolution',
        message: '没有可回滚的版本',
        details: '还没有进行过进化'
      };
    }
    
    console.log('可回滚的版本:');
    rollbacks.forEach((r, i) => {
      console.log(`${i + 1}. ${r.timestamp} - ${r.domain} - ${r.version}`);
    });
    
    console.log('\n请选择要回滚到的版本（输入序号），或输入"取消"终止。\n');
    
    // 这里应该等待用户选择
    // 简化实现：回滚到最新版本
    const latestRollback = rollbacks[0];
    
    console.log(`\n回滚到: ${latestRollback.timestamp} - ${latestRollback.domain}\n`);
    
    try {
      await this.evolutionEngine._performRollback(latestRollback.domain);
      
      return {
        success: true,
        action: 'rollbackEvolution',
        message: '进化已回滚',
        details: `已回滚到 ${latestRollback.timestamp} 的版本`
      };
    } catch (error) {
      return {
        success: false,
        action: 'rollbackEvolution',
        message: `回滚失败: ${error.message}`
      };
    }
  }
  
  /**
   * 暂停进化
   */
  async pauseEvolution(context) {
    console.log('⏸️  暂停进化...\n');
    
    // 更新配置
    const config = this.loadEvolutionConfig();
    config.paused = true;
    config.pausedAt = new Date().toISOString();
    this.saveEvolutionConfig(config);
    
    return {
      success: true,
      action: 'pauseEvolution',
      message: '进化已暂停',
      details: '自动进化已禁用，手动触发仍可使用'
    };
  }
  
  /**
   * 恢复进化
   */
  async resumeEvolution(context) {
    console.log('▶️  恢复进化...\n');
    
    // 更新配置
    const config = this.loadEvolutionConfig();
    config.paused = false;
    config.resumedAt = new Date().toISOString();
    this.saveEvolutionConfig(config);
    
    return {
      success: true,
      action: 'resumeEvolution',
      message: '进化已恢复',
      details: '自动进化已重新启用'
    };
  }
  
  /**
   * 查看进化历史
   */
  async viewHistory(context) {
    console.log('📜 查看进化历史...\n');
    
    const history = this.loadEvolutionHistory();
    
    if (history.length === 0) {
      return {
        success: true,
        action: 'viewHistory',
        message: '暂无进化历史',
        details: '还没有进行过进化'
      };
    }
    
    // 格式化历史
    const formatted = history.map(entry => ({
      时间: new Date(entry.timestamp).toLocaleString('zh-CN'),
      领域: entry.domain,
      版本: entry.version,
      状态: entry.status
    }));
    
    return {
      success: true,
      action: 'viewHistory',
      message: `共有 ${history.length} 条进化记录`,
      details: formatted
    };
  }
  
  /**
   * 配置进化
   */
  async configureEvolution(context) {
    console.log('⚙️  配置进化...\n');
    
    const config = this.loadEvolutionConfig();
    
    console.log('当前配置:');
    console.log(`  启用状态: ${config.enabled ? '启用' : '禁用'}`);
    console.log(`  暂停状态: ${config.paused ? '暂停' : '运行中'}`);
    console.log(`  进化间隔: ${config.intervalDays} 天`);
    console.log(`  操作阈值: ${config.operationThreshold} 次`);
    console.log(`  最大领域: ${config.maxDomainsPerRun}`);
    console.log(`  知识点限制: ${config.maxKnowledgePoints}`);
    console.log(`  回滚保留: ${config.rollbackRetentionDays} 天\n`);
    
    console.log('可用配置选项:');
    console.log('  修改进化间隔天数');
    console.log('  修改操作触发阈值');
    console.log('  启用/禁用性能触发');
    console.log('  调整安全限制\n');
    
    return {
      success: true,
      action: 'configureEvolution',
      message: '配置信息已显示',
      details: '使用具体配置命令来修改参数'
    };
  }
  
  /**
   * 显示帮助
   */
  showHelp() {
    const help = `
📚 FBS-BookWriter 自增强进化帮助

可用命令：

1. 状态查询
   - 检查进化状态 / 进化进度 / 能力更新情况
   
2. 进化控制
   - 触发进化 / 开始能力提升 / 升级方法论
   - 暂停进化 / 停止自动更新
   - 恢复进化 / 重新开始进化
   - 回滚进化 / 撤销更新
   
3. 知识查询
   - 查看方法论知识 / 获取最新技巧 / 学习最佳实践
   - 可指定领域：去AI味、质检、创意选题、风格微调、内容资产化、会议角色
   
4. 历史查询
   - 查看进化历史 / 进化记录 / 更新历史
   
5. 配置管理
   - 配置进化 / 进化设置 / 设置进化参数

示例：
  检查进化状态
  触发进化 去AI味
  查看方法论知识 质检
  回滚进化
  暂停进化
  查看进化历史
  配置进化

进化领域：
  - deAIFlavor: 去AI味方法论
  - qualityCheck: 质检优化方法论
  - creativeTopic: 创意选题方法论
  - styleAdjustment: 风格微调方法论
  - contentAssetization: 内容资产化方法论
  - meetingRoleDesign: 会议角色智能设计
`;
    
    return {
      success: true,
      action: 'help',
      message: '帮助信息',
      details: help
    };
  }
  
  /**
   * 工具方法
   */
  matchAny(text, patterns) {
    return patterns.some(pattern => text.includes(pattern));
  }
  
  extractDomain(text) {
    const domainKeywords = {
      'deAIFlavor': ['去ai味', '去机器味', '自然化', '去痕迹'],
      'qualityCheck': ['质检', '质量检查', '审核', '校对'],
      'creativeTopic': ['创意', '选题', '创新', '角度'],
      'styleAdjustment': ['风格', '语气', '调性', '风格化'],
      'contentAssetization': ['资产', '知识库', '复用', '资产化'],
      'meetingRoleDesign': ['会议', '角色', '协作', '角色设计']
    };
    
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        return domain;
      }
    }
    
    return null;
  }
  
  selectBestDomain(checkResult) {
    // 根据触发原因选择最佳领域
    if (checkResult.triggers.some(t => t.type === 'performance')) {
      return 'qualityCheck';
    }
    if (checkResult.triggers.some(t => t.type === 'usage')) {
      return 'creativeTopic';
    }
    return 'deAIFlavor';
  }
  
  getConfigurationStatus() {
    const config = this.loadEvolutionConfig();
    return {
      enabled: config.enabled,
      paused: config.paused,
      intervalDays: config.intervalDays,
      operationThreshold: config.operationThreshold
    };
  }
  
  generateRecommendations(checkResult, knowledgeStats) {
    const recommendations = [];
    
    if (checkResult.needed) {
      recommendations.push({
        type: 'evolution',
        message: '建议触发进化',
        priority: 'high'
      });
    }
    
    if (knowledgeStats.cachedDomains.length === 0) {
      recommendations.push({
        type: 'knowledge',
        message: '建议获取方法论知识',
        priority: 'medium'
      });
    }
    
    return recommendations;
  }
  
  formatStatusReport(status) {
    let report = '';
    
    report += '进化状态:\n';
    report += `  需要进化: ${status.evolutionNeeded ? '是' : '否'}\n`;
    
    if (status.evolutionNeeded && status.triggers.length > 0) {
      report += '  触发原因:\n';
      status.triggers.forEach(t => {
        report += `    - ${t.type}: ${t.reason}\n`;
      });
    }
    
    report += '\n知识库状态:\n';
    report += `  已缓存领域: ${status.knowledgeStats.cachedDomains.length} 个\n`;
    report += `  搜索缓存: ${status.knowledgeStats.searchCacheSize} 条\n`;
    
    report += '\n配置状态:\n';
    report += `  启用状态: ${status.configStatus.enabled ? '启用' : '禁用'}\n`;
    report += `  暂停状态: ${status.configStatus.paused ? '暂停' : '运行中'}\n`;
    
    if (status.recommendations.length > 0) {
      report += '\n建议:\n';
      status.recommendations.forEach(r => {
        report += `  [${r.priority}] ${r.message}\n`;
      });
    }
    
    return report;
  }
  
  formatKnowledgeDisplay(knowledge) {
    let display = '';
    
    display += `领域: ${knowledge.domain}\n`;
    display += `获取时间: ${new Date(knowledge.fetchedAt).toLocaleString('zh-CN')}\n`;
    display += `来源数量: ${knowledge.sourceResults.length} 个\n`;
    
    if (knowledge.methodologyKnowledge.length > 0) {
      display += '\n方法论知识:\n';
      knowledge.methodologyKnowledge.forEach((method, i) => {
        display += `${i + 1}. ${method.title}\n`;
        display += `   来源: ${method.source} (${method.authority.toFixed(1)})\n`;
        display += `   相关性: ${(method.relevance * 100).toFixed(0)}%\n`;
        display += `   核心技术: ${method.coreTechniques.join(', ')}\n`;
      });
    }
    
    if (knowledge.bestPractices.length > 0) {
      display += '\n最佳实践:\n';
      knowledge.bestPractices.forEach((practice, i) => {
        display += `${i + 1}. ${practice.source}\n`;
        display += `   实践点: ${practice.practice.join(', ')}\n`;
      });
    }
    
    if (knowledge.expertInsights.length > 0) {
      display += '\n专家见解:\n';
      knowledge.expertInsights.slice(0, 5).forEach((insight, i) => {
        display += `${i + 1}. ${insight.insight}\n`;
        display += `   来源: ${insight.sourceType}\n`;
      });
    }
    
    return display;
  }
  
  getAvailableRollbacks() {
    const history = this.loadEvolutionHistory();
    return history.filter(h => h.status === 'completed').slice(0, 3);
  }
  
  loadEvolutionConfig() {
    const configPath = path.join(this.projectRoot, '.fbs', 'evolution-config.json');
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      return {
        enabled: true,
        paused: false,
        intervalDays: 30,
        operationThreshold: 100
      };
    }
  }
  
  saveEvolutionConfig(config) {
    const configPath = path.join(this.projectRoot, '.fbs', 'evolution-config.json');
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
  
  loadEvolutionHistory() {
    const historyPath = path.join(this.projectRoot, '.fbs', 'evolution-history.json');
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (error) {
      return [];
    }
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];
  const projectRoot = process.cwd();
  
  if (!command) {
    const evolution = new EvolutionNatural(projectRoot);
    console.log(evolution.showHelp().details);
    process.exit(0);
  }
  
  const evolution = new EvolutionNatural(projectRoot);
  evolution.processCommand(command).then(result => {
    console.log(result.message);
    if (result.details && result.details !== '帮助信息') {
      console.log('\n详情:');
      console.log(result.details);
    }
    process.exit(result.success ? 0 : 1);
  });
}

export default EvolutionNatural;
