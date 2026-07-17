#!/usr/bin/env node
/**
 * 负载均衡器
 * 
 * 职责:
 * - 分配任务到智能体
 * - 监控智能体负载
 * - 动态调整分配策略
 */

export class LoadBalancer {
  constructor(options = {}) {
    this.options = {
      strategy: options.strategy || 'least-connections', // round-robin, least-connections, fastest-response, weighted-round-robin
      agentPool: options.agentPool || null,
      healthCheckInterval: options.healthCheckInterval || 30000, // 30秒
      ...options
    };
    
    this.acquisitionHistory = [];
    this.healthCheckTimer = null;
    this.roundRobinIndex = 0;
    
    this._startHealthCheck();
  }

  /**
   * 获取智能体
   * @returns {Promise<object>} - { agent, release }
   */
  async acquire() {
    if (!this.options.agentPool) {
      throw new Error('AgentPool not configured');
    }
    
    const agentType = this._getAgentType();
    
    let agentWrapper;
    
    // 根据策略选择智能体
    switch (this.options.strategy) {
      case 'round-robin':
        agentWrapper = await this._acquireRoundRobin(agentType);
        break;
      case 'least-connections':
        agentWrapper = await this._acquireLeastConnections(agentType);
        break;
      case 'fastest-response':
        agentWrapper = await this._acquireFastestResponse(agentType);
        break;
      case 'weighted-round-robin':
        agentWrapper = await this._acquireWeightedRoundRobin(agentType);
        break;
      default:
        agentWrapper = await this._acquireLeastConnections(agentType);
    }
    
    // 记录获取历史
    this.acquisitionHistory.push({
      agentId: agentWrapper.agent.agentId,
      timestamp: Date.now(),
      strategy: this.options.strategy
    });
    
    // 限制历史记录大小
    if (this.acquisitionHistory.length > 1000) {
      this.acquisitionHistory.shift();
    }
    
    return agentWrapper;
  }

  /**
   * 获取负载均衡器状态
   * @returns {object} - 负载均衡器状态
   */
  getStatus() {
    const agentType = this._getAgentType();
    const poolStatus = this.options.agentPool?.getPoolStatus(agentType);
    
    return {
      strategy: this.options.strategy,
      agentType,
      poolStatus,
      acquisitionHistory: this.acquisitionHistory.slice(-10)
    };
  }

  /**
   * 切换策略
   * @param {string} strategy - 新策略
   */
  switchStrategy(strategy) {
    const validStrategies = ['round-robin', 'least-connections', 'fastest-response', 'weighted-round-robin'];
    
    if (!validStrategies.includes(strategy)) {
      throw new Error(`Invalid strategy: ${strategy}`);
    }
    
    console.log(`[LoadBalancer] Strategy switched: ${this.options.strategy} -> ${strategy}`);
    this.options.strategy = strategy;
  }

  /**
   * 获取推荐策略
   * @returns {string} - 推荐策略
   */
  getRecommendedStrategy() {
    // 根据历史数据推荐策略
    if (this.acquisitionHistory.length < 10) {
      return 'least-connections'; // 默认策略
    }
    
    // 分析响应时间
    const agentStats = this._analyzeAgentStats();
    
    if (agentStats.hasVariance) {
      return 'least-connections'; // 负载不均衡,使用最少连接
    } else if (agentStats.hasFastAgent) {
      return 'fastest-response'; // 有快速智能体,使用最快响应
    } else {
      return 'weighted-round-robin'; // 性能均衡,使用加权轮询
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    console.log('[LoadBalancer] Cleaned up');
  }

  // ========== 私有方法 ==========

  /**
   * 轮询策略
   */
  async _acquireRoundRobin(agentType) {
    const poolStatus = this.options.agentPool.getPoolStatus(agentType);
    const totalAgents = poolStatus.totalAgents;
    
    if (totalAgents === 0) {
      throw new Error('No agents available');
    }
    
    this.roundRobinIndex = (this.roundRobinIndex + 1) % totalAgents;
    
    return this.options.agentPool.acquireAgent(agentType);
  }

  /**
   * 最少连接策略
   */
  async _acquireLeastConnections(agentType) {
    // AgentPool已经实现了负载均衡,直接使用
    return this.options.agentPool.acquireAgent(agentType);
  }

  /**
   * 最快响应策略
   */
  async _acquireFastestResponse(agentType) {
    // 分析历史数据,选择响应最快的智能体
    const agentStats = this._analyzeAgentStats();
    
    if (agentStats.fastestAgent) {
      // 尝试获取最快的智能体
      try {
        const { agent, release } = await this.options.agentPool.acquireAgent(agentType);
        if (agent.agentId === agentStats.fastestAgent) {
          return { agent, release };
        } else {
          release(); // 不是最快的,释放并重试
        }
      } catch (error) {
        // 忽略错误,使用默认策略
      }
    }
    
    // 回退到最少连接策略
    return this._acquireLeastConnections(agentType);
  }

  /**
   * 加权轮询策略
   */
  async _acquireWeightedRoundRobin(agentType) {
    const agentStats = this._analyzeAgentStats();
    
    // 根据性能权重选择智能体
    // 性能越好,权重越高
    const weights = agentStats.weights || {};
    
    // 这里简化实现,实际应该根据权重选择
    return this.options.agentPool.acquireAgent(agentType);
  }

  /**
   * 分析智能体统计
   */
  _analyzeAgentStats() {
    if (this.acquisitionHistory.length < 10) {
      return {};
    }
    
    const agentStats = new Map();
    
    // 统计每个智能体的使用次数
    this.acquisitionHistory.forEach(record => {
      const count = agentStats.get(record.agentId) || 0;
      agentStats.set(record.agentId, count + 1);
    });
    
    // 计算平均值和方差
    const counts = Array.from(agentStats.values());
    const avg = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / counts.length;
    
    // 判断是否有方差(负载不均衡)
    const hasVariance = variance > avg * 0.1;
    
    // 判断是否有快速智能体(这里简化实现)
    const hasFastAgent = false;
    const fastestAgent = null;
    
    // 计算权重(这里简化实现)
    const weights = {};
    
    return {
      hasVariance,
      hasFastAgent,
      fastestAgent,
      weights
    };
  }

  /**
   * 获取智能体类型
   */
  _getAgentType() {
    if (!this.options.agentPool) {
      throw new Error('AgentPool not configured');
    }
    
    const status = this.options.agentPool.getAllPoolStatus();
    const agentTypes = Object.keys(status);
    
    if (agentTypes.length === 0) {
      throw new Error('No agent pools available');
    }
    
    // 返回第一个智能体类型
    return agentTypes[0];
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
    // 检查智能体池健康状态
    const status = this.getStatus();
    
    if (!status.poolStatus) {
      console.warn('[LoadBalancer] AgentPool status not available');
      return;
    }
    
    // 检查利用率
    if (status.poolStatus.utilization > 90) {
      console.warn(`[LoadBalancer] High utilization: ${status.poolStatus.utilization.toFixed(1)}%`);
      
      // 自动切换策略
      if (this.options.strategy === 'round-robin') {
        this.switchStrategy('least-connections');
      }
    }
  }
}
