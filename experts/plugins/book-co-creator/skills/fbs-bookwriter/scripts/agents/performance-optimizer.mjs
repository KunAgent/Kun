#!/usr/bin/env node
/**
 * 性能优化器
 * 
 * 职责:
 * - 缓存常用数据
 * - 批处理优化
 * - 预加载资源
 * - 延迟加载
 */

export class PerformanceOptimizer {
  constructor(options = {}) {
    this.options = {
      cacheSize: options.cacheSize || 100,
      cacheTTL: options.cacheTTL || 30 * 60 * 1000, // 30分钟
      enableCache: options.enableCache !== false,
      enableBatching: options.enableBatching !== false,
      batchDelay: options.batchDelay || 100, // 100ms
      ...options
    };
    
    this.cache = new Map();
    this.batchQueues = new Map(); // operationKey -> [{ data, resolve, reject }]
    this.batchTimers = new Map(); // operationKey -> timer
    this.preloadQueue = [];
    this.preloadedResources = new Map();
    
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      batchOperations: 0,
      preloadedResources: 0
    };
  }

  /**
   * 获取缓存
   * @param {string} key - 缓存键
   * @returns {any|null} - 缓存值
   */
  getCache(key) {
    if (!this.options.enableCache) {
      return null;
    }
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.cacheMisses++;
      return null;
    }
    
    // 检查是否过期
    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.cache.delete(key);
      this.stats.cacheMisses++;
      return null;
    }
    
    this.stats.cacheHits++;
    console.log(`[PerformanceOptimizer] Cache hit: ${key}`);
    return entry.value;
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   */
  setCache(key, value) {
    if (!this.options.enableCache) {
      return;
    }
    
    // 检查缓存大小
    if (this.cache.size >= this.options.cacheSize) {
      this._evictLRU();
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
    
    console.log(`[PerformanceOptimizer] Cache set: ${key}`);
  }

  /**
   * 批处理操作
   * @param {string} operationKey - 操作键
   * @param {any} data - 操作数据
   * @param {function} batchFn - 批处理函数
   * @returns {Promise<any>} - 批处理结果
   */
  async batch(operationKey, data, batchFn) {
    if (!this.options.enableBatching) {
      return batchFn([data]);
    }
    
    return new Promise((resolve, reject) => {
      // 添加到批处理队列
      const queue = this.batchQueues.get(operationKey) || [];
      queue.push({ data, resolve, reject });
      this.batchQueues.set(operationKey, queue);
      
      // 设置批处理定时器
      if (!this.batchTimers.has(operationKey)) {
        const timer = setTimeout(() => {
          this._executeBatch(operationKey, batchFn);
        }, this.options.batchDelay);
        this.batchTimers.set(operationKey, timer);
      }
    });
  }

  /**
   * 预加载资源
   * @param {string} resourceKey - 资源键
   * @param {function} loadFn - 加载函数
   */
  async preload(resourceKey, loadFn) {
    if (this.preloadedResources.has(resourceKey)) {
      console.log(`[PerformanceOptimizer] Resource already preloaded: ${resourceKey}`);
      return;
    }
    
    console.log(`[PerformanceOptimizer] Preloading resource: ${resourceKey}`);
    
    try {
      const resource = await loadFn();
      this.preloadedResources.set(resourceKey, {
        resource,
        timestamp: Date.now()
      });
      
      this.stats.preloadedResources++;
      
    } catch (error) {
      console.error(`[PerformanceOptimizer] Preload failed: ${resourceKey} - ${error.message}`);
    }
  }

  /**
   * 获取预加载的资源
   * @param {string} resourceKey - 资源键
   * @returns {any|null} - 预加载的资源
   */
  getPreloaded(resourceKey) {
    const entry = this.preloadedResources.get(resourceKey);
    
    if (!entry) {
      return null;
    }
    
    return entry.resource;
  }

  /**
   * 延迟加载
   * @param {function} loadFn - 加载函数
   * @param {number} delay - 延迟时间(毫秒)
   * @returns {Promise<any>} - 加载结果
   */
  async lazyLoad(loadFn, delay = 0) {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    return loadFn();
  }

  /**
   * 获取性能统计
   * @returns {object} - 性能统计
   */
  getStats() {
    const cacheHitRate = this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses || 1);
    
    return {
      ...this.stats,
      cacheHitRate,
      cacheSize: this.cache.size,
      batchQueues: Array.from(this.batchQueues.keys()).length,
      preloadedResources: this.preloadedResources.size
    };
  }

  /**
   * 打印性能统计
   */
  printStats() {
    const stats = this.getStats();
    
    console.log('\n========== 性能优化统计 ==========');
    console.log(`缓存命中: ${stats.cacheHits}`);
    console.log(`缓存未命中: ${stats.cacheMisses}`);
    console.log(`缓存命中率: ${(stats.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`缓存大小: ${stats.cacheSize}`);
    console.log(`批处理操作: ${stats.batchOperations}`);
    console.log(`预加载资源: ${stats.preloadedResources}`);
    console.log('====================================\n');
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清理缓存
    this.cache.clear();
    
    // 清理批处理定时器
    this.batchTimers.forEach(timer => clearTimeout(timer));
    this.batchTimers.clear();
    this.batchQueues.clear();
    
    // 清理预加载资源
    this.preloadedResources.clear();
    
    console.log('[PerformanceOptimizer] Cleaned up');
  }

  // ========== 私有方法 ==========

  /**
   * 执行批处理
   */
  async _executeBatch(operationKey, batchFn) {
    // 清除定时器
    const timer = this.batchTimers.get(operationKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(operationKey);
    }
    
    // 获取批处理队列
    const queue = this.batchQueues.get(operationKey);
    if (!queue || queue.length === 0) {
      return;
    }
    
    // 清空队列
    this.batchQueues.delete(operationKey);
    
    console.log(`[PerformanceOptimizer] Executing batch: ${operationKey} (${queue.length} operations)`);
    
    try {
      // 执行批处理
      const dataArray = queue.map(item => item.data);
      const results = await batchFn(dataArray);
      
      // 分发结果
      queue.forEach((item, index) => {
        if (results[index] !== undefined) {
          item.resolve(results[index]);
        } else {
          item.resolve(null);
        }
      });
      
      this.stats.batchOperations++;
      
    } catch (error) {
      // 所有操作失败
      queue.forEach(item => {
        item.reject(error);
      });
      
      console.error(`[PerformanceOptimizer] Batch failed: ${operationKey} - ${error.message}`);
    }
  }

  /**
   * 淘汰最久未使用的缓存
   */
  _evictLRU() {
    let oldestKey = null;
    let oldestTimestamp = Date.now();
    
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`[PerformanceOptimizer] Evicted LRU cache: ${oldestKey}`);
    }
  }
}
