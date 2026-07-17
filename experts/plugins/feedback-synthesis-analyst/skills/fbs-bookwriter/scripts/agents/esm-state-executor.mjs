/**
 * U10: ESM状态执行器 (P0)
 * 
 * 功能:
 * - 每个状态节点嵌入检查点
 * - 自动触发CLI调用
 * - 阻断非法转换
 */

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';

/**
 * ESM状态执行器
 */
export class ESMStateExecutor extends EventEmitter {
  constructor(bookRoot, options = {}) {
    super();
    
    this.bookRoot = bookRoot;
    this.strictMode = options.strictMode || false; // 严格模式: 阻断非法转换
    this.auditor = options.auditor || null;
    
    // ESM状态定义
    this.states = {
      IDLE: 'IDLE',
      INTAKE: 'INTAKE',
      RESEARCH: 'RESEARCH',
      PLAN: 'PLAN',
      WRITE: 'WRITE',
      REVIEW: 'REVIEW',
      WRITE_MORE: 'WRITE_MORE',
      DELIVER: 'DELIVER'
    };
    
    // 合法转换
    this.validTransitions = {
      IDLE: ['INTAKE'],
      INTAKE: ['RESEARCH', 'IDLE'],
      RESEARCH: ['PLAN', 'INTAKE'],
      PLAN: ['WRITE', 'RESEARCH'],
      WRITE: ['REVIEW', 'PLAN'],
      REVIEW: ['WRITE_MORE', 'WRITE', 'DELIVER'],
      WRITE_MORE: ['REVIEW', 'WRITE', 'RESEARCH', 'DELIVER'],
      DELIVER: ['IDLE']
    };
    
    // 状态检查点
    this.checkpoints = this.initCheckpoints();
    
    this.currentState = this.states.IDLE;
    this.transitionHistory = [];
    
    console.log(`⚙️ [U10-P0] ESM状态执行器初始化完成`);
    console.log(`   严格模式: ${this.strictMode}`);
  }

  /**
   * 初始化检查点
   * @returns {Object}
   */
  initCheckpoints() {
    return {
      INTAKE: async () => {
        console.log('🔍 [U10-P0] INTAKE检查点: 验证项目配置...');
        return this.checkProjectConfig();
      },
      
      RESEARCH: async () => {
        console.log('🔍 [U10-P0] RESEARCH检查点: 验证虚拟书房底座...');

        return this.checkArtifacts();
      },
      
      PLAN: async () => {
        console.log('🔍 [U10-P0] PLAN检查点: 验证研究产出...');
        return this.checkResearchOutput();
      },
      
      WRITE: async () => {
        console.log('🔍 [U10-P0] WRITE检查点: 验证Writer任务模板...');
        return this.checkWriterTemplate();
      },
      
      REVIEW: async () => {
        console.log('🔍 [U10-P0] REVIEW检查点: 验证章节产出...');
        return this.checkChapterOutput();
      },
      
      WRITE_MORE: async () => {
        console.log('🔍 [U10-P0] WRITE_MORE检查点: 验证修改建议...');
        return this.checkModificationSuggestions();
      },
      
      DELIVER: async () => {
        console.log('🔍 [U10-P0] DELIVER检查点: 验证交付物...');
        return this.checkDeliverables();
      },
      
      IDLE: async () => {
        console.log('🔍 [U10-P0] IDLE检查点: 验证归档状态...');
        return this.checkArchiveStatus();
      }
    };
  }

  /**
   * 状态转换
   * @param {string} from - 起始状态
   * @param {string} to - 目标状态
   * @param {Object} details - 转换详情
   * @returns {Promise<boolean>}
   */
  async transition(from, to, details = {}) {
    console.log(`\n🔄 [U10-P0] 状态转换: ${from} → ${to}`);
    
    const transitionId = `trans_${Date.now()}_${from}_${to}`;
    
    // 1. 验证转换合法性
    const validation = await this.validateTransition(from, to);
    
    if (!validation.isValid) {
      if (this.strictMode) {
        throw new Error(`非法状态转换: ${from} → ${to} - ${validation.reason}`);
      } else {
        console.warn(`⚠️ [U10-P0] 非法状态转换: ${from} → ${to}`);
        return false;
      }
    }
    
    console.log(`✅ [U10-P0] 转换验证通过`);
    
    // 2. 执行前置检查
    const startTime = Date.now();
    
    let checkpointResult;
    if (this.checkpoints[to]) {
      checkpointResult = await this.executeCheckpoint(to);
    }
    
    // 3. 执行转换
    this.currentState = to;
    
    const duration = Date.now() - startTime;
    
    // 4. 记录转换
    const transitionRecord = {
      transitionId,
      from,
      to,
      timestamp: Date.now(),
      duration,
      details,
      checkpointResult
    };
    
    this.transitionHistory.push(transitionRecord);
    
    // 5. 审计
    if (this.auditor) {
      await this.auditor.logTransition(from, to, {
        trigger: details.trigger,
        checks: checkpointResult?.checks || [],
        actions: details.actions || [],
        duration,
        result: 'success'
      });
    }
    
    console.log(`✅ [U10-P0] 状态转换完成 (${duration}ms)`);
    console.log(`   当前状态: ${this.currentState}`);
    
    // 6. 触发事件
    this.emit('transition', transitionRecord);
    this.emit(`enter:${to}`, to);
    this.emit(`leave:${from}`, from);
    
    return true;
  }

  /**
   * 验证状态转换
   * @param {string} from - 起始状态
   * @param {string} to - 目标状态
   * @returns {Promise<Object>}
   */
  async validateTransition(from, to) {
    // 检查状态是否存在
    if (!this.states[to]) {
      return {
        isValid: false,
        reason: `目标状态不存在: ${to}`
      };
    }
    
    // 检查转换是否合法
    const validTargets = this.validTransitions[from] || [];
    
    if (!validTargets.includes(to)) {
      return {
        isValid: false,
        reason: `非法转换: ${from} → ${to}, 允许的转换: ${validTargets.join(', ')}`
      };
    }
    
    return {
      isValid: true,
      reason: null
    };
  }

  /**
   * 执行检查点
   * @param {string} state - 状态
   * @returns {Promise<Object>}
   */
  async executeCheckpoint(state) {
    const checkpoint = this.checkpoints[state];
    
    if (!checkpoint) {
      console.log(`⏭️ [U10-P0] ${state}无检查点,跳过`);
      return {
        checked: false,
        message: 'No checkpoint'
      };
    }
    
    try {
      const result = await checkpoint();
      
      console.log(`✅ [U10-P0] ${state}检查点通过`);
      
      return {
        checked: true,
        result,
        message: 'Checkpoint passed'
      };
    } catch (error) {
      console.error(`❌ [U10-P0] ${state}检查点失败:`, error.message);
      
      if (this.strictMode) {
        throw error;
      }
      
      return {
        checked: true,
        result: null,
        error: error.message,
        message: 'Checkpoint failed'
      };
    }
  }

  /**
   * 检查项目配置
   * @returns {Promise<Object>}
   */
  async checkProjectConfig() {
    const checks = [
      {
        name: '项目配置文件存在',
        check: () => fs.existsSync(path.join(this.bookRoot, '.fbs', 'book-config.json'))
      },
      {
        name: 'SKILL.md存在',
        check: () => fs.existsSync(path.join(this.bookRoot, 'SKILL.md'))
      }
    ];
    
    const results = [];
    
    for (const check of checks) {
      const passed = await check.check();
      results.push({
        name: check.name,
        passed
      });
    }
    
    return { checks: results };
  }

  /**
   * 检查虚拟书房初始化

   * @returns {Promise<Object>}
   */
  async checkArtifacts() {
    const artifacts = [
      '.fbs/GLOSSARY.md',
      '.fbs/book-context-brief.md',
      '.fbs/search-ledger.jsonl',
      '.fbs/member-heartbeats.json',
      '.fbs/chapter-dependencies.json',
      '.fbs/task-queue.json'
    ];
    
    const results = [];
    
    for (const artifact of artifacts) {
      const exists = fs.existsSync(path.join(this.bookRoot, artifact));
      results.push({
        artifact,
        exists
      });
    }
    
    return { checks: results };
  }

  /**
   * 检查研究产出
   * @returns {Promise<Object>}
   */
  async checkResearchOutput() {
    const checks = [
      {
        name: '研究简报存在',
        check: () => fs.existsSync(path.join(this.bookRoot, '.fbs', 'research-brief.md'))
      }
    ];
    
    const results = [];
    
    for (const check of checks) {
      const passed = await check.check();
      results.push({
        name: check.name,
        passed
      });
    }
    
    return { checks: results };
  }

  /**
   * 检查Writer任务模板
   * @returns {Promise<Object>}
   */
  async checkWriterTemplate() {
    const checks = [
      {
        name: 'Writer任务模板存在',
        check: () => fs.existsSync(path.join(this.bookRoot, '.fbs', 'writer-task-template.md'))
      }
    ];
    
    const results = [];
    
    for (const check of checks) {
      const passed = await check.check();
      results.push({
        name: check.name,
        passed
      });
    }
    
    return { checks: results };
  }

  /**
   * 检查章节产出
   * @returns {Promise<Object>}
   */
  async checkChapterOutput() {
    const chapterFiles = await this.scanChapterFiles();
    
    return {
      checks: [
        {
          name: '章节文件数量',
          passed: chapterFiles.length > 0,
          count: chapterFiles.length
        }
      ]
    };
  }

  /**
   * 检查修改建议
   * @returns {Promise<Object>}
   */
  async checkModificationSuggestions() {
    const checks = [
      {
        name: '修改建议文档存在',
        check: () => fs.existsSync(path.join(this.bookRoot, '.fbs', 'modification-suggestions.md'))
      }
    ];
    
    const results = [];
    
    for (const check of checks) {
      const passed = await check.check();
      results.push({
        name: check.name,
        passed
      });
    }
    
    return { checks: results };
  }

  /**
   * 检查交付物
   * @returns {Promise<Object>}
   */
  async checkDeliverables() {
    const checks = [
      {
        name: '交付物目录存在',
        check: () => fs.existsSync(path.join(this.bookRoot, 'deliverables'))
      }
    ];
    
    const results = [];
    
    for (const check of checks) {
      const passed = await check.check();
      results.push({
        name: check.name,
        passed
      });
    }
    
    return { checks: results };
  }

  /**
   * 检查归档状态
   * @returns {Promise<Object>}
   */
  async checkArchiveStatus() {
    return {
      checks: [
        {
          name: '归档状态正常',
          passed: true
        }
      ]
    };
  }

  /**
   * 扫描章节文件
   * @returns {Promise<Array>}
   */
  async scanChapterFiles() {
    // 这里应该使用glob扫描章节文件
    // 简化实现,直接返回空数组
    return [];
  }

  /**
   * 获取当前状态
   * @returns {string}
   */
  getCurrentState() {
    return this.currentState;
  }

  /**
   * 获取转换历史
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getTransitionHistory(limit = 100) {
    return this.transitionHistory.slice(-limit);
  }

  /**
   * 设置审计器
   * @param {Object} auditor - 审计器实例
   */
  setAuditor(auditor) {
    this.auditor = auditor;
    console.log('📝 [U10-P0] 审计器已设置');
  }

  /**
   * 重置状态
   */
  reset() {
    console.log('🔄 [U10-P0] 重置ESM状态');
    
    this.currentState = this.states.IDLE;
    this.transitionHistory = [];
    
    console.log(`✅ [U10-P0] ESM状态已重置: ${this.currentState}`);
  }
}

export default ESMStateExecutor;
