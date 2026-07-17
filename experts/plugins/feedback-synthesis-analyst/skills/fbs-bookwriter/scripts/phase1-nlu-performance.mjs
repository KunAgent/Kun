#!/usr/bin/env node
/**
 * Phase 1: NLU性能优化 - 具体实现
 * 
 * 重点优化：
 * 1. 意图识别算法性能（Trie树、Bloom Filter）
 * 2. 缓存命中率优化（LRU-K、预热机制）
 * 3. 内存占用优化（对象池、String interning）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Trie树实现 - 优化关键词搜索
 */
class TrieNode {
  constructor() {
    this.children = new Map();
    this.isEnd = false;
    this.intent = null;
    this.weight = 0;
  }
}

class TrieTree {
  constructor() {
    this.root = new TrieNode();
  }
  
  insert(word, intent, weight = 1) {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
    }
    node.isEnd = true;
    node.intent = intent;
    node.weight = weight;
  }
  
  search(word) {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) {
        return null;
      }
      node = node.children.get(char);
    }
    if (node.isEnd) {
      return { intent: node.intent, weight: node.weight };
    }
    return null;
  }
  
  searchPrefix(prefix) {
    let node = this.root;
    for (const char of prefix.toLowerCase()) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char);
    }
    
    const results = [];
    this._collectWords(node, prefix, results);
    return results;
  }
  
  _collectWords(node, prefix, results) {
    if (node.isEnd) {
      results.push({ word: prefix, intent: node.intent, weight: node.weight });
    }
    
    for (const [char, child] of node.children.entries()) {
      this._collectWords(child, prefix + char, results);
    }
  }
}

/**
 * Bloom Filter实现 - 加速候选匹配
 */
class BloomFilter {
  constructor(size = 10000, hashFunctions = 3) {
    this.size = size;
    this.bitArray = new Array(size).fill(false);
    this.hashFunctions = hashFunctions;
  }
  
  _hash1(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % this.size;
  }
  
  _hash2(key) {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) + key.charCodeAt(i);
    }
    return Math.abs(hash) % this.size;
  }
  
  _hash3(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % this.size;
  }
  
  add(key) {
    const hash1 = this._hash1(key);
    const hash2 = this._hash2(key);
    const hash3 = this._hash3(key);
    
    this.bitArray[hash1] = true;
    this.bitArray[hash2] = true;
    this.bitArray[hash3] = true;
  }
  
  mightContain(key) {
    const hash1 = this._hash1(key);
    const hash2 = this._hash2(key);
    const hash3 = this._hash3(key);
    
    return this.bitArray[hash1] && 
           this.bitArray[hash2] && 
           this.bitArray[hash3];
  }
}

/**
 * LRU-K缓存策略
 */
class LRUKCache {
  constructor(maxSize = 100, k = 2) {
    this.maxSize = maxSize;
    this.k = k;
    this.cache = new Map();
    this.accessHistory = new Map();
  }
  
  get(key) {
    const history = this.accessHistory.get(key);
    if (!history) return null;
    
    // 更新访问历史
    history.push(Date.now());
    if (history.length > this.k) {
      history.shift();
    }
    
    return this.cache.get(key);
  }
  
  set(key, value, ttl = 300000) {
    // 如果已存在，更新访问历史
    if (!this.accessHistory.has(key)) {
      this.accessHistory.set(key, []);
    }
    this.accessHistory.get(key).push(Date.now());
    
    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl,
      accessCount: (this.cache.get(key)?.accessCount || 0) + 1
    });
    
    // 检查是否需要淘汰
    this._evictIfNeeded();
  }
  
  _evictIfNeeded() {
    if (this.cache.size <= this.maxSize) return;
    
    // 计算每个键的分数
    const scores = [];
    for (const [key, history] of this.accessHistory.entries()) {
      let score = 0;
      for (let i = 0; i < history.length; i++) {
        const recency = Date.now() - history[i];
        score += Math.pow(2, this.k - i - 1) / recency;
      }
      scores.push({ key, score });
    }
    
    // 淘汰分数最低的
    scores.sort((a, b) => a.score - b.score);
    const evictKey = scores[0].key;
    
    this.cache.delete(evictKey);
    this.accessHistory.delete(evictKey);
  }
  
  clear() {
    this.cache.clear();
    this.accessHistory.clear();
  }
}

/**
 * 对象池 - 减少GC压力
 */
class ObjectPool {
  constructor(factoryFn, resetFn, initialSize = 100) {
    this.factoryFn = factoryFn;
    this.resetFn = resetFn;
    this.pool = [];
    
    // 预分配对象
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factoryFn());
    }
  }
  
  acquire() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    return this.factoryFn();
  }
  
  release(obj) {
    if (this.resetFn) {
      this.resetFn(obj);
    }
    this.pool.push(obj);
  }
}

/**
 * String Interning - 优化内存使用
 */
class StringInterner {
  constructor() {
    this.internedStrings = new Map();
  }
  
  intern(str) {
    if (this.internedStrings.has(str)) {
      return this.internedStrings.get(str);
    }
    
    this.internedStrings.set(str, str);
    return str;
  }
  
  clear() {
    this.internedStrings.clear();
  }
  
  getStats() {
    return {
      totalStrings: this.internedStrings.size,
      memorySavings: this.internedStrings.size * 50 // 估算节省的内存（字节）
    };
  }
}

/**
 * 增强的NLU引擎
 */
export class EnhancedNLUEngine {
  constructor() {
    // 初始化Trie树
    this.trie = new TrieTree();
    this.bloomFilter = new BloomFilter(10000, 3);
    
    // 初始化缓存
    this.intentCache = new LRUKCache(1000, 2);
    this.semanticCache = new LRUKCache(500, 2);
    
    // 初始化对象池
    this.resultPool = new ObjectPool(
      () => ({ intent: null, confidence: 0, method: null }),
      (obj) => { obj.intent = null; obj.confidence = 0; obj.method = null; },
      200
    );
    
    // 初始化String Interning
    this.interner = new StringInterner();
    
    // 性能统计
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      trieHits: 0,
      bloomFilterMisses: 0,
      averageResponseTime: 0
    };
    
    // 预热缓存
    this._preheatCache();
  }
  
  /**
   * 构建Trie树
   */
  buildTrie(intentMap) {
    for (const [intent, triggers] of Object.entries(intentMap)) {
      for (const trigger of triggers) {
        this.trie.insert(trigger, intent);
        this.bloomFilter.add(trigger);
      }
    }
  }
  
  /**
   * 缓存预热
   */
  _preheatCache() {
    const commonIntents = [
      'WRITE_BOOK', 'CONTINUE', 'REVIEW', 'EXPORT', 'HELP'
    ];
    
    for (const intent of commonIntents) {
      const result = { intent, confidence: 0.9, method: 'preheated' };
      this.intentCache.set(intent, result);
    }
    
    console.log('✅ NLU缓存预热完成');
  }
  
  /**
   * 增强的意图识别
   */
  async recognizeIntent(input) {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    // String interning
    const internedInput = this.interner.intern(input.toLowerCase().trim());
    
    // 1. 检查缓存
    const cachedResult = this.intentCache.get(internedInput);
    if (cachedResult && !this._isExpired(cachedResult)) {
      this.stats.cacheHits++;
      return cachedResult;
    }
    
    // 2. Bloom Filter快速过滤
    if (!this.bloomFilter.mightContain(internedInput)) {
      this.stats.bloomFilterMisses++;
      return this._getDefaultResult();
    }
    
    // 3. Trie树精确匹配
    const trieResult = this.trie.search(internedInput);
    if (trieResult) {
      this.stats.trieHits++;
      const result = {
        intent: trieResult.intent,
        confidence: Math.min(1.0, 0.5 + trieResult.weight * 0.1),
        method: 'trie_exact'
      };
      this.intentCache.set(internedInput, result);
      return result;
    }
    
    // 4. Trie前缀匹配
    const prefixResults = this.trie.searchPrefix(internedInput.substring(0, 3));
    if (prefixResults.length > 0) {
      const bestMatch = prefixResults[0];
      const result = {
        intent: bestMatch.intent,
        confidence: 0.7,
        method: 'trie_prefix'
      };
      this.intentCache.set(internedInput, result);
      return result;
    }
    
    // 5. 兜底
    const defaultResult = this._getDefaultResult();
    this.intentCache.set(internedInput, defaultResult);
    return defaultResult;
  }
  
  /**
   * 检查缓存是否过期
   */
  _isExpired(cacheEntry) {
    if (!cacheEntry.createdAt) return false;
    const age = Date.now() - cacheEntry.createdAt;
    return age > (cacheEntry.ttl || 300000);
  }
  
  /**
   * 获取默认结果
   */
  _getDefaultResult() {
    return { intent: 'HELP', confidence: 0.5, method: 'fallback' };
  }
  
  /**
   * 批量识别
   */
  async recognizeBatch(inputs) {
    const results = [];
    for (const input of inputs) {
      const result = await this.recognizeIntent(input);
      results.push(result);
    }
    return results;
  }
  
  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.totalRequests > 0 
        ? (this.stats.cacheHits / this.stats.totalRequests).toFixed(4)
        : 0,
      trieHitRate: this.stats.totalRequests > 0
        ? (this.stats.trieHits / this.stats.totalRequests).toFixed(4)
        : 0,
      internerStats: this.interner.getStats()
    };
  }
  
  /**
   * 清理缓存
   */
  clearCache() {
    this.intentCache.clear();
    this.semanticCache.clear();
    this.interner.clear();
    console.log('✅ NLU缓存已清理');
  }
}

// 导出工具类
export { TrieTree, BloomFilter, LRUKCache, ObjectPool, StringInterner };

export default EnhancedNLUEngine;
