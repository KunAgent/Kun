#!/usr/bin/env node
/**
 * 智能体池
 * 
 * 功能:
 * - 智能体实例池化管理
 * - 资源分配和回收
 * - 负载均衡
 * - 智能体健康检查
 */

export class AgentPool {
  constructor(options = {}) {
    this.options = {
      poolSize: options.poolSize || 3,
      idleTimeout: options.idleTimeout || 30 * 1000, // 30秒
      healthCheckInterval: options.healthCheckInterval || 60 * 1000, // 1分钟
      ...options
    };
    
    this.pools = {}; // agentType -> [{ agent, inUse, lastUsed }]
    this.poolStats = {}; // agentType -> { created, acquired, released, errors }
    
    this.healthCheckTimer = null;
    this.idleCheckTimer = null;
    
    this._startHealthCheck();
    this._startIdleCheck();
  }

  /**
   * 初始化智能体池
   * @param {object} agentConfig - 智能体配置 { agentType: AgentClass, options: {} }
   */
  initializePool(agentConfig) {
    const { agentType, AgentClass, options = {} } = agentConfig;
    
    if (this.pools[agentType]) {
      console.warn(`[AgentPool] Pool already initialized: ${agentType}`);
      return;
    }
    
    // 初始化池
    this.pools[agentType] = {
      AgentClass,
      options,
      agents: []
    };
    
    // 初始化统计
    this.poolStats[agentType] = {
      created: 0,
      acquired: 0,
      released: 0,
      errors: 0,
      maxPoolSize: this.options.poolSize
    };
    
    // 预创建智能体
    for (let i = 0; i < this.options.poolSize; i++) {
      this._createAgent(agentType);
    }
    
    console.log(`[AgentPool] Pool initialized: ${agentType} (size: ${this.options.poolSize})`);
  }

  /**
   * 获取智能体
   * @param {string} agentType - 智能体类型
   * @returns {Promise<object>} - 智能体对象
   */
  async acquireAgent(agentType) {
    const pool = this.pools[agentType];
    if (!pool) {
      throw new Error(`Pool not initialized: ${agentType}`);
    }
    
    // 查找空闲智能体
    let agent = pool.agents.find(a => !a.inUse);
    
    // 如果没有空闲智能体,尝试创建新智能体
    if (!agent) {
      if (pool.agents.length < this.options.poolSize) {
        agent = this._createAgent(agentType);
      } else {
        // 池已满,等待
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.acquireAgent(agentType);
      }
    }
    
    // 标记为使用中
    agent.inUse = true;
    agent.lastUsed = Date.now();
    
    // 更新统计
    this.poolStats[agentType].acquired++;
    
    console.log(`[AgentPool] Agent acquired: ${agentType} (${agent.agent.agentId})`);
    
    // 返回智能体和释放函数
    return {
      agent: agent.agent,
      release: () => this.releaseAgent(agentType, agent.agentId)
    };
  }

  /**
   * 释放智能体
   * @param {string} agentType - 智能体类型
   * @param {string} agentId - 智能体ID
   */
  releaseAgent(agentType, agentId) {
    const pool = this.pools[agentType];
    if (!pool) {
      console.warn(`[AgentPool] Pool not found: ${agentType}`);
      return;
    }
    
    const agent = pool.agents.find(a => a.agent.agentId === agentId);
    if (!agent) {
      console.warn(`[AgentPool] Agent not found: ${agentId}`);
      return;
    }
    
    // 标记为空闲
    agent.inUse = false;
    agent.lastUsed = Date.now();
    
    // 更新统计
    this.poolStats[agentType].released++;
    
    console.log(`[AgentPool] Agent released: ${agentType} (${agentId})`);
  }

  /**
   * 获取池状态
   * @param {string} agentType - 智能体类型
   * @returns {object} - 池状态
   */
  getPoolStatus(agentType) {
    const pool = this.pools[agentType];
    if (!pool) {
      throw new Error(`Pool not initialized: ${agentType}`);
    }
    
    const inUseAgents = pool.agents.filter(a => a.inUse);
    const idleAgents = pool.agents.filter(a => !a.inUse);
    
    return {
      agentType,
      totalAgents: pool.agents.length,
      inUseAgents: inUseAgents.length,
      idleAgents: idleAgents.length,
      utilization: (inUseAgents.length / pool.agents.length) * 100,
      stats: this.poolStats[agentType]
    };
  }

  /**
   * 获取所有池状态
   * @returns {object} - 所有池状态
   */
  getAllPoolStatus() {
    const status = {};
    
    for (const agentType of Object.keys(this.pools)) {
      status[agentType] = this.getPoolStatus(agentType);
    }
    
    return status;
  }

  /**
   * 打印池状态
   */
  printPoolStatus() {
    console.log('\n========== 智能体池状态 ==========');
    
    for (const [agentType, status] of Object.entries(this.getAllPoolStatus())) {
      console.log(`\n${agentType}:`);
      console.log(`  总数: ${status.totalAgents}`);
      console.log(`  使用中: ${status.inUseAgents}`);
      console.log(`  空闲: ${status.idleAgents}`);
      console.log(`  利用率: ${status.utilization.toFixed(1)}%`);
      console.log(`  获取次数: ${status.stats.acquired}`);
      console.log(`  释放次数: ${status.stats.released}`);
      console.log(`  错误次数: ${status.stats.errors}`);
    }
    
    console.log('==================================\n');
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止健康检查
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // 停止空闲检查
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
    
    // 停止所有智能体
    for (const [agentType, pool] of Object.entries(this.pools)) {
      pool.agents.forEach(agentWrapper => {
        agentWrapper.agent.stop();
      });
    }
    
    console.log('[AgentPool] Cleaned up');
  }

  // ========== 私有方法 ==========

  /**
   * 创建智能体
   */
  _createAgent(agentType) {
    const pool = this.pools[agentType];
    
    // 创建智能体实例
    const agent = new pool.AgentClass(pool.options);
    agent.start();
    
    // 包装智能体
    const agentWrapper = {
      agent,
      inUse: false,
      lastUsed: Date.now(),
      createdAt: Date.now()
    };
    
    // 添加到池
    pool.agents.push(agentWrapper);
    
    // 更新统计
    this.poolStats[agentType].created++;
    
    console.log(`[AgentPool] Agent created: ${agentType} (${agent.agentId})`);
    
    return agentWrapper;
  }

  /**
   * 启动健康检查
   */
  _startHealthCheck() {
    this.healthCheckTimer = setInterval(() => {
      this._performHealthCheck();
    }, this.options.healthCheckInterval);
  }

  /**
   * 执行健康检查
   */
  _performHealthCheck() {
    for (const [agentType, pool] of Object.entries(this.pools)) {
      pool.agents.forEach(agentWrapper => {
        try {
          // 检查智能体状态
          const metrics = agentWrapper.agent.getMetrics();
          
          // 如果智能体错误过多,重启
          if (metrics.tasksFailed > 10 && metrics.tasksFailed / (metrics.tasksCompleted + metrics.tasksFailed) > 0.5) {
            console.warn(`[AgentPool] Agent unhealthy, restarting: ${agentWrapper.agent.agentId}`);
            this._restartAgent(agentType, agentWrapper);
          }
        } catch (error) {
          console.error(`[AgentPool] Health check error: ${error.message}`);
          this.poolStats[agentType].errors++;
        }
      });
    }
  }

  /**
   * 启动空闲检查
   */
  _startIdleCheck() {
    this.idleCheckTimer = setInterval(() => {
      this._performIdleCheck();
    }, this.options.idleTimeout);
  }

  /**
   * 执行空闲检查
   */
  _performIdleCheck() {
    const now = Date.now();
    
    for (const [agentType, pool] of Object.entries(this.pools)) {
      pool.agents.forEach(agentWrapper => {
        // 如果智能体空闲超过超时时间,且池中有多个智能体,则销毁
        const idleTime = now - agentWrapper.lastUsed;
        if (!agentWrapper.inUse && 
            idleTime > this.options.idleTimeout && 
            pool.agents.length > 1) {
          console.log(`[AgentPool] Agent idle, destroying: ${agentWrapper.agent.agentId}`);
          this._destroyAgent(agentType, agentWrapper);
        }
      });
    }
  }

  /**
   * 重启智能体
   */
  _restartAgent(agentType, agentWrapper) {
    // 停止旧智能体
    agentWrapper.agent.stop();
    
    // 创建新智能体
    const newAgent = new pool.AgentClass(pool.options);
    newAgent.start();
    
    // 替换
    agentWrapper.agent = newAgent;
    agentWrapper.lastUsed = Date.now();
    agentWrapper.createdAt = Date.now();
    
    // 更新统计
    this.poolStats[agentType].created++;
  }

  /**
   * 销毁智能体
   */
  _destroyAgent(agentType, agentWrapper) {
    const pool = this.pools[agentType];
    
    // 停止智能体
    agentWrapper.agent.stop();
    
    // 从池中移除
    const index = pool.agents.indexOf(agentWrapper);
    if (index !== -1) {
      pool.agents.splice(index, 1);
    }
    
    console.log(`[AgentPool] Agent destroyed: ${agentType} (${agentWrapper.agent.agentId})`);
  }
}
