#!/usr/bin/env node
/**
 * 事件总线
 * 
 * 功能:
 * - 发布-订阅模式
 * - 请求-响应模式
 * - 消息去重
 * - 消息持久化
 */

import { EventEmitter } from 'events';

export class EventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enablePersistence: options.enablePersistence || false,
      enableDeduplication: options.enableDeduplication || true,
      persistencePath: options.persistencePath || null,
      maxListeners: options.maxListeners || 100,
      ...options
    };
    
    this.messageHistory = new Map(); // 用于去重
    this.messageStore = []; // 用于持久化
    this.requestMap = new Map(); // 用于请求-响应模式
    this.messageCleanupTimers = new Map(); // 去重清理定时器
    this.setMaxListeners(this.options.maxListeners);

  }

  /**
   * 发布事件
   * @param {string} topic - 事件主题
   * @param {object} message - 消息对象
   */
  publish(topic, message) {
    // 消息去重
    if (this.options.enableDeduplication) {
      const messageKey = this._getMessageKey(topic, message);
      if (this.messageHistory.has(messageKey)) {
        console.warn(`[EventBus] Duplicate message detected: ${topic}`);
        return false;
      }
      this.messageHistory.set(messageKey, Date.now());
      
      // 清理过期的去重记录(10分钟后)
      const cleanupTimer = setTimeout(() => {
        this.messageHistory.delete(messageKey);
        this.messageCleanupTimers.delete(messageKey);
      }, 10 * 60 * 1000);
      if (typeof cleanupTimer.unref === 'function') {
        cleanupTimer.unref();
      }
      this.messageCleanupTimers.set(messageKey, cleanupTimer);

    }

    // 消息持久化
    if (this.options.enablePersistence) {
      this._persistMessage(topic, message);
    }

    // 发布事件
    this.emit(topic, message);
    return true;
  }

  /**
   * 订阅事件
   * @param {string} topic - 事件主题
   * @param {function} handler - 处理函数
   */
  subscribe(topic, handler) {
    this.on(topic, handler);
    console.log(`[EventBus] Subscribed to: ${topic}`);
  }

  /**
   * 取消订阅
   * @param {string} topic - 事件主题
   * @param {function} handler - 处理函数
   */
  unsubscribe(topic, handler) {
    this.off(topic, handler);
    console.log(`[EventBus] Unsubscribed from: ${topic}`);
  }

  /**
   * 请求-响应模式
   * @param {string} topic - 事件主题
   * @param {object} message - 请求消息
   * @param {number} timeout - 超时时间(毫秒)
   * @returns {Promise<object>} - 响应消息
   */
  async request(topic, message, timeout = 30000) {
    const requestId = message.messageId || this._generateMessageId();
    message.messageId = requestId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requestMap.delete(requestId);
        reject(new Error(`Request timeout: ${requestId}`));
      }, timeout);

      this.requestMap.set(requestId, { resolve, reject, timer });

      // 发布请求
      this.publish(topic, message);

      // 订阅响应
      const responseTopic = `${topic}.response`;
      const responseHandler = (response) => {
        if (response.messageId === requestId) {
          clearTimeout(timer);
          this.requestMap.delete(requestId);
          this.unsubscribe(responseTopic, responseHandler);
          resolve(response);
        }
      };
      this.subscribe(responseTopic, responseHandler);
    });
  }

  /**
   * 响应请求
   * @param {string} topic - 事件主题
   * @param {object} message - 响应消息
   */
  respond(topic, message) {
    const responseTopic = `${topic}.response`;
    this.publish(responseTopic, message);
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.removeAllListeners();
    this.messageHistory.clear();
    this.messageCleanupTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.messageCleanupTimers.clear();
    this.requestMap.forEach(({ timer }) => {
      clearTimeout(timer);
    });
    this.requestMap.clear();
    console.log('[EventBus] Cleaned up');
  }


  // ========== 私有方法 ==========

  _getMessageKey(topic, message) {
    return `${topic}:${message.messageId || message.taskId || 'unknown'}`;
  }

  _generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _persistMessage(topic, message) {
    const record = {
      topic,
      message,
      timestamp: Date.now()
    };
    this.messageStore.push(record);
    
    // 限制存储大小
    if (this.messageStore.length > 1000) {
      this.messageStore.shift();
    }
  }
}

// 单例模式
let eventBusInstance = null;

export function getEventBus(options = {}) {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus(options);
  }
  return eventBusInstance;
}

export function cleanupEventBus() {
  if (eventBusInstance) {
    eventBusInstance.cleanup();
    eventBusInstance = null;
  }
}
