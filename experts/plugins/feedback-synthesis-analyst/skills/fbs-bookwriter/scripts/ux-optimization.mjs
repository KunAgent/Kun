#!/usr/bin/env node
/**
 * FBS-BookWriter 防卡顿和用户体验优化方案
 * 
 * 目标：提升用户体验，防止系统卡顿、无响应等问题
 * 
 * 优化方向：
 * 1. 性能监控和预警
 * 2. 并发控制和资源管理
 * 3. 进度反馈和状态更新
 * 4. 超时处理和错误恢复
 * 5. 内存管理和垃圾回收
 */

export const UX_OPTIMIZATION = {
  version: '1.0.0',
  lastUpdated: '2026-04-08',
  
  // ========================================
  // 性能监控体系
  // ========================================
  performanceMonitoring: {
    // 关键指标监控
    keyMetrics: {
      responseTime: {
        target: 1000,        // 1秒
        warning: 3000,        // 3秒
        critical: 5000,       // 5秒
        unit: 'ms'
      },
      
      memoryUsage: {
        target: 256 * 1024 * 1024,  // 256MB
        warning: 400 * 1024 * 1024,  // 400MB
        critical: 512 * 1024 * 1024,  // 512MB
        unit: 'bytes'
      },
      
      cpuUsage: {
        target: 50,           // 50%
        warning: 80,          // 80%
        critical: 100,         // 100%
        unit: 'percent'
      },
      
      networkLatency: {
        target: 500,          // 500ms
        warning: 2000,        // 2秒
        critical: 5000,       // 5秒
        unit: 'ms'
      },
      
      fileIOTime: {
        target: 100,          // 100ms
        warning: 500,         // 500ms
        critical: 1000,       // 1秒
        unit: 'ms'
      }
    },
    
    // 监控频率
    monitoringIntervals: {
      memory: 5000,           // 5秒
      cpu: 3000,             // 3秒
      performance: 10000,     // 10秒
      network: 5000           // 5秒
    },
    
    // 预警规则
    alertRules: {
      consecutiveWarnings: 3,    // 连续3次警告触发
      warningWindow: 30000,       // 30秒窗口
      autoRecovery: true,         // 自动恢复
      notifyUser: true            // 通知用户
    }
  },
  
  // ========================================
  // 并发控制策略
  // ========================================
  concurrencyControl: {
    // 文件操作并发
    fileOperations: {
      maxConcurrentReads: 3,        // 最大并发读操作
      maxConcurrentWrites: 1,       // 最大并发写操作
      queueSize: 50,                // 队列大小
      priority: 'FIFO',             // 先进先出
      
      // 大文件处理
      largeFileThreshold: 10 * 1024 * 1024,  // 10MB
      largeFileChunkSize: 1024 * 1024,        // 1MB分块
      streamProcessing: true
    },
    
    // 网络请求并发
    networkRequests: {
      maxConcurrentRequests: 3,       // 最大并发请求
      maxRequestsPerMinute: 20,       // 每分钟最大请求数
      rateLimitWindow: 60000,          // 60秒
      retryPolicy: 'exponential_backoff',
      maxRetries: 2,
      retryDelays: [1000, 2000, 5000]  // 1秒, 2秒, 5秒
    },
    
    // 异步任务并发
    asyncTasks: {
      maxConcurrentTasks: 5,         // 最大并发任务
      taskQueueSize: 100,            // 任务队列大小
      timeoutMs: 300000,             // 5分钟超时
      abortOnTimeout: true
    },
    
    // Agent 并发
    agentConcurrency: {
      maxAgents: 10,                // 最大Agent数量
      maxParallelAgents: 5,          // 最大并行Agent
      agentPoolSize: 15,             // Agent池大小
      idleTimeout: 120000            // 2分钟空闲超时
    }
  },
  
  // ========================================
  // 进度反馈系统
  // ========================================
  progressFeedback: {
    // 进度报告频率
    reportingIntervals: {
      fast: 500,                   // 快速任务：500ms
      normal: 2000,                // 普通任务：2秒
      slow: 10000,                 // 慢速任务：10秒
      verySlow: 30000              // 很慢任务：30秒
    },
    
    // 进度显示格式
    displayFormats: {
      percentage: true,            // 百分比
      bar: true,                   // 进度条
      eta: true,                   // 预计剩余时间
      currentStep: true,            // 当前步骤
      totalSteps: true,             // 总步骤数
      speed: true                   // 处理速度
    },
    
    // 心跳机制
    heartbeat: {
      enabled: true,
      interval: 30000,             // 30秒心跳
      timeout: 60000,              // 60秒超时
      message: '福帮手正在工作中...'
    },
    
    // 防卡顿反馈
    antiLag: {
      longOperationThreshold: 5000,   // 5秒
      feedbackInterval: 2000,          // 2秒
      feedbackMessages: [
        '正在处理中，请稍候...',
        '还在处理，预计还需要一些时间...',
        '处理进度：已完成{progress}%',
        '即将完成...'
      ]
    }
  },
  
  // ========================================
  // 超时处理机制
  // ========================================
  timeoutHandling: {
    // 操作超时配置
    operationTimeouts: {
      fileRead: 5000,              // 5秒
      fileWrite: 10000,            // 10秒
      directoryScan: 15000,         // 15秒
      networkRequest: 15000,        // 15秒
      agentExecution: 300000,       // 5分钟
      qualityCheck: 60000,          // 1分钟
      documentGeneration: 120000     // 2分钟
    },
    
    // 超时处理策略
    strategies: {
      warn: {
        threshold: 0.7,            // 70%超时时间
        action: 'warn_user'
      },
      gracefulShutdown: {
        threshold: 0.9,            // 90%超时时间
        action: 'graceful_shutdown'
      },
      hardTimeout: {
        threshold: 1.0,            // 100%超时时间
        action: 'hard_timeout'
      }
    },
    
    // 重试策略
    retryPolicy: {
      enabled: true,
      maxRetries: 3,
      retryConditions: [
        'network_error',
        'timeout',
        'temporary_failure'
      ],
      backoffStrategy: 'exponential',
      initialDelay: 1000,          // 1秒
      maxDelay: 10000               // 10秒
    }
  },
  
  // ========================================
  // 内存管理
  // ========================================
  memoryManagement: {
    // 垃圾回收策略
    garbageCollection: {
      enabled: true,
      interval: 60000,              // 1分钟
      triggers: [
        'memory_warning',
        'operation_complete',
        'queue_empty'
      ],
      forceGC: false                 // 不强制GC
    },
    
    // 缓存管理
    cacheManagement: {
      enabled: true,
      maxSize: 100 * 1024 * 1024,  // 100MB
      ttl: 300000,                  // 5分钟
      evictionPolicy: 'LRU',        // 最近最少使用
      cleanupInterval: 120000        // 2分钟清理一次
    },
    
    // 流式处理
    streaming: {
      enabled: true,
      threshold: 5 * 1024 * 1024,  // 5MB
      chunkSize: 1024 * 1024,        // 1MB
      bufferPoolSize: 10
    },
    
    // 内存优化
    memoryOptimization: {
      reuseBuffers: true,
      limitStringAllocations: true,
      useTypedArrays: true,
      avoidDeepCopies: true
    }
  },
  
  // ========================================
  // 错误恢复机制
  // ========================================
  errorRecovery: {
    // 错误分类
    errorCategories: {
      recoverable: [
        'network_timeout',
        'temporary_file_lock',
        'resource_exhausted'
      ],
      unrecoverable: [
        'disk_full',
        'permission_denied',
        'corrupted_data'
      ],
      user_correctable: [
        'invalid_input',
        'ambiguous_command',
        'confirmation_needed'
      ]
    },
    
    // 恢复策略
    recoveryStrategies: {
      network_timeout: 'retry_with_backoff',
      temporary_file_lock: 'wait_and_retry',
      resource_exhausted: 'free_resources_retry',
      invalid_input: 'ask_user_clarification',
      ambiguous_command: 'provide_suggestions'
    },
    
    // 断点恢复
    checkpointRecovery: {
      enabled: true,
      interval: 60000,              // 1分钟
      maxCheckpoints: 10,
      checkpointLocation: '.fbs/checkpoints/',
      autoRestore: true
    },
    
    // 状态回滚
    stateRollback: {
      enabled: true,
      keepHistory: 5,
      rollbackOnError: true,
      confirmRollback: true
    }
  },
  
  // ========================================
  // 用户体验优化
  // ========================================
  userExperience: {
    // 响应速度优化
    responseOptimization: {
      immediateAck: true,           // 立即确认
      backgroundProcessing: true,    // 后台处理
      progressiveEnhancement: true,  // 渐进增强
      
      // 预加载
      preloading: {
        enabled: true,
        preloadResources: [
          'templates',
          'assets',
          'frequently_used_docs'
        ]
      }
    },
    
    // 友好的错误提示
    errorMessaging: {
      userFriendly: true,
      provideSolutions: true,
      showTechnicalDetails: false,   // 默认不显示技术细节
      logTechnicalDetails: true      // 但记录技术细节
    },
    
    // 智能提示
    smartSuggestions: {
      enabled: true,
      basedOnContext: true,
      basedOnHistory: true,
      maxSuggestions: 3
    },
    
    // 可取消操作
    cancelableOperations: {
      enabled: true,
      cancelMethod: 'keyboard_interrupt',
      gracefulShutdown: true,
      cleanupOnCancel: true
    }
  }
};

/**
 * 防卡顿控制器
 */
export class AntiLagController {
  constructor(config = UX_OPTIMIZATION) {
    this.config = config;
    this.activeOperations = new Map();
    this.performanceMetrics = [];
    this.alertCount = 0;
  }
  
  /**
   * 开始操作追踪
   */
  startOperation(operationName) {
    const operation = {
      name: operationName,
      startTime: Date.now(),
      lastProgressTime: Date.now(),
      progress: 0,
      status: 'running'
    };
    
    this.activeOperations.set(operationName, operation);
    
    // 设置进度报告定时器
    this._setupProgressReporting(operationName);
    
    return operation;
  }
  
  /**
   * 更新操作进度
   */
  updateProgress(operationName, progress) {
    const operation = this.activeOperations.get(operationName);
    if (!operation) return;
    
    operation.progress = progress;
    operation.lastProgressTime = Date.now();
    
    // 检查是否长时间无进度更新
    const timeSinceLastProgress = Date.now() - operation.lastProgressTime;
    if (timeSinceLastProgress > this.config.progressFeedback.antiLag.longOperationThreshold) {
      this._sendProgressFeedback(operation);
    }
  }
  
  /**
   * 完成操作
   */
  completeOperation(operationName) {
    const operation = this.activeOperations.get(operationName);
    if (!operation) return;
    
    operation.status = 'completed';
    operation.endTime = Date.now();
    operation.duration = operation.endTime - operation.startTime;
    
    // 记录性能指标
    this.performanceMetrics.push({
      operation: operationName,
      duration: operation.duration,
      status: operation.status,
      timestamp: new Date().toISOString()
    });
    
    this.activeOperations.delete(operationName);
    return operation;
  }
  
  /**
   * 检查性能警告
   */
  checkPerformanceWarnings() {
    const warnings = [];
    const config = this.config.performanceMonitoring.keyMetrics;
    
    // 检查内存使用
    const memoryUsage = this._getMemoryUsage();
    if (memoryUsage > config.memoryUsage.warning) {
      warnings.push({
        type: 'memory_warning',
        current: memoryUsage,
        threshold: config.memoryUsage.warning
      });
      this.alertCount++;
    }
    
    // 检查操作超时
    for (const [name, operation] of this.activeOperations) {
      const elapsed = Date.now() - operation.startTime;
      const timeout = this.config.timeoutHandling.operationTimeouts[name] || 300000;
      
      if (elapsed > timeout * 0.7) {
        warnings.push({
          type: 'operation_slow',
          operation: name,
          elapsed: elapsed,
          timeout: timeout
        });
      }
    }
    
    // 检查连续警告
    if (this.alertCount >= this.config.performanceMonitoring.alertRules.consecutiveWarnings) {
      warnings.push({
        type: 'consecutive_warnings',
        count: this.alertCount
      });
    }
    
    return warnings;
  }
  
  /**
   * 获取性能报告
   */
  getPerformanceReport() {
    const metrics = this.performanceMetrics;
    
    if (metrics.length === 0) {
      return { message: '暂无性能数据' };
    }
    
    const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
    const maxDuration = Math.max(...metrics.map(m => m.duration));
    const minDuration = Math.min(...metrics.map(m => m.duration));
    
    const completed = metrics.filter(m => m.status === 'completed').length;
    const failed = metrics.filter(m => m.status === 'failed').length;
    
    return {
      totalOperations: metrics.length,
      completed,
      failed,
      averageDuration: `${(avgDuration / 1000).toFixed(2)}s`,
      maxDuration: `${(maxDuration / 1000).toFixed(2)}s`,
      minDuration: `${(minDuration / 1000).toFixed(2)}s`,
      successRate: `${((completed / metrics.length) * 100).toFixed(1)}%`
    };
  }
  
  /**
   * 设置进度报告
   */
  _setupProgressReporting(operationName) {
    const interval = setInterval(() => {
      const operation = this.activeOperations.get(operationName);
      if (!operation || operation.status !== 'running') {
        clearInterval(interval);
        return;
      }
      
      // 发送进度反馈
      this._sendProgressFeedback(operation);
      
      // 检查性能警告
      const warnings = this.checkPerformanceWarnings();
      if (warnings.length > 0) {
        this._handleWarnings(warnings);
      }
    }, this.config.progressFeedback.reportingIntervals.normal);
  }
  
  /**
   * 发送进度反馈
   */
  _sendProgressFeedback(operation) {
    const elapsed = Date.now() - operation.startTime;
    const isLongOperation = elapsed > this.config.progressFeedback.antiLag.longOperationThreshold;
    
    if (isLongOperation) {
      const messages = this.config.progressFeedback.antiLag.feedbackMessages;
      const messageIndex = Math.floor((elapsed / 10000) % messages.length);
      console.log(`[进度] ${messages[messageIndex].replace('{progress}', operation.progress)}`);
    }
  }
  
  /**
   * 处理警告
   */
  _handleWarnings(warnings) {
    for (const warning of warnings) {
      switch (warning.type) {
        case 'memory_warning':
          console.warn(`[性能警告] 内存使用过高: ${this._formatBytes(warning.current)}MB`);
          if (typeof global.gc === 'function') {
            global.gc();
          }
          break;
          
        case 'operation_slow':
          console.warn(`[性能警告] 操作耗时过长: ${warning.operation}`);
          break;
          
        case 'consecutive_warnings':
          console.error(`[性能警告] 连续警告过多: ${warning.count}`);
          // 可以考虑暂停或优化
          break;
      }
    }
  }
  
  /**
   * 获取内存使用
   */
  _getMemoryUsage() {
    if (typeof process !== 'undefined') {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }
  
  /**
   * 格式化字节数
   */
  _formatBytes(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
  }
}

export default UX_OPTIMIZATION;
