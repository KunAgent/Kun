#!/usr/bin/env node
/**
 * 故障恢复
 * 
 * 职责:
 * - 检测任务失败
 * - 自动重试任务
 * - 降级处理
 * - 故障统计和分析
 */

export class FailureRecovery {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // 1秒
      exponentialBackoff: options.exponentialBackoff !== false,
      ...options
    };
    
    this.failureHistory = new Map(); // taskId -> { error, retryCount, lastRetryTime }
    this.failureStats = {
      totalFailures: 0,
      retriedFailures: 0,
      recoveredFailures: 0,
      unrecoveredFailures: 0,
      byStage: {},
      byErrorType: {}
    };
  }

  /**
   * 处理失败
   * @param {object} task - 任务对象
   * @param {Error} error - 错误对象
   * @returns {Promise<boolean>} - 是否应该重试
   */
  async handleFailure(task, error) {
    const taskId = task.taskId;
    const stage = task.currentStage;
    const errorType = this._getErrorType(error);
    
    // 记录失败历史
    const failureRecord = {
      taskId,
      stage,
      error: error.message,
      errorType,
      retryCount: 0,
      lastRetryTime: Date.now(),
      createdAt: Date.now()
    };
    
    const existingRecord = this.failureHistory.get(taskId);
    if (existingRecord) {
      existingRecord.retryCount++;
      existingRecord.lastRetryTime = Date.now();
    } else {
      this.failureHistory.set(taskId, failureRecord);
    }
    
    // 更新统计
    this._updateFailureStats(stage, errorType);
    
    console.warn(`[FailureRecovery] Task failed: ${taskId} (${stage}) - ${error.message}`);
    
    // 判断是否应该重试
    const shouldRetry = await this._shouldRetry(task, error, failureRecord);
    
    if (shouldRetry) {
      this.failureStats.retriedFailures++;
      console.log(`[FailureRecovery] Retrying task: ${taskId} (attempt ${failureRecord.retryCount + 1})`);
    } else {
      this.failureStats.unrecoveredFailures++;
      console.error(`[FailureRecovery] Task unrecoverable: ${taskId}`);
    }
    
    return shouldRetry;
  }

  /**
   * 标记任务恢复
   * @param {string} taskId - 任务ID
   */
  markRecovered(taskId) {
    this.failureStats.recoveredFailures++;
    this.failureHistory.delete(taskId);
    
    console.log(`[FailureRecovery] Task recovered: ${taskId}`);
  }

  /**
   * 获取失败统计
   * @returns {object} - 失败统计
   */
  getFailureStats() {
    return {
      ...this.failureStats,
      recoveryRate: this.failureStats.recoveredFailures / (this.failureStats.totalFailures || 1)
    };
  }

  /**
   * 打印失败统计
   */
  printFailureStats() {
    const stats = this.getFailureStats();
    
    console.log('\n========== 故障恢复统计 ==========');
    console.log(`总失败次数: ${stats.totalFailures}`);
    console.log(`重试次数: ${stats.retriedFailures}`);
    console.log(`恢复次数: ${stats.recoveredFailures}`);
    console.log(`未恢复次数: ${stats.unrecoveredFailures}`);
    console.log(`恢复率: ${(stats.recoveryRate * 100).toFixed(1)}%`);
    
    if (Object.keys(stats.byStage).length > 0) {
      console.log('\n按阶段统计:');
      for (const [stage, count] of Object.entries(stats.byStage)) {
        console.log(`  ${stage}: ${count}`);
      }
    }
    
    if (Object.keys(stats.byErrorType).length > 0) {
      console.log('\n按错误类型统计:');
      for (const [errorType, count] of Object.entries(stats.byErrorType)) {
        console.log(`  ${errorType}: ${count}`);
      }
    }
    
    console.log('================================\n');
  }

  /**
   * 清理过期的失败记录
   * @param {number} ttl - 存活时间(毫秒)
   */
  cleanupOldRecords(ttl = 24 * 60 * 60 * 1000) { // 默认24小时
    const now = Date.now();
    const cleanedCount = 0;
    
    for (const [taskId, record] of this.failureHistory) {
      if (now - record.createdAt > ttl) {
        this.failureHistory.delete(taskId);
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[FailureRecovery] Cleaned up ${cleanedCount} old failure records`);
    }
  }

  // ========== 私有方法 ==========

  /**
   * 判断是否应该重试
   */
  async _shouldRetry(task, error, record) {
    // 检查重试次数
    if (record.retryCount >= this.options.maxRetries) {
      console.warn(`[FailureRecovery] Max retries reached for task: ${task.taskId}`);
      return false;
    }
    
    // 检查错误类型
    const errorType = this._getErrorType(error);
    
    // 不可重试的错误
    if (errorType === 'validation' || errorType === 'permission') {
      console.warn(`[FailureRecovery] Non-retryable error type: ${errorType}`);
      return false;
    }
    
    // 检查任务优先级
    if (task.priority === 'low' && record.retryCount >= 1) {
      console.log(`[FailureRecovery] Skipping retry for low priority task: ${task.taskId}`);
      return false;
    }
    
    // 计算延迟
    let delay = this.options.retryDelay;
    
    if (this.options.exponentialBackoff) {
      delay = delay * Math.pow(2, record.retryCount);
    }
    
    // 等待延迟
    console.log(`[FailureRecovery] Waiting ${delay}ms before retry...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return true;
  }

  /**
   * 获取错误类型
   */
  _getErrorType(error) {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('timeout')) {
      return 'timeout';
    } else if (message.includes('network') || message.includes('connection')) {
      return 'network';
    } else if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    } else if (message.includes('permission') || message.includes('unauthorized')) {
      return 'permission';
    } else if (message.includes('not found') || message.includes('404')) {
      return 'not-found';
    } else {
      return 'unknown';
    }
  }

  /**
   * 更新失败统计
   */
  _updateFailureStats(stage, errorType) {
    this.failureStats.totalFailures++;
    
    // 按阶段统计
    if (!this.failureStats.byStage[stage]) {
      this.failureStats.byStage[stage] = 0;
    }
    this.failureStats.byStage[stage]++;
    
    // 按错误类型统计
    if (!this.failureStats.byErrorType[errorType]) {
      this.failureStats.byErrorType[errorType] = 0;
    }
    this.failureStats.byErrorType[errorType]++;
  }
}
