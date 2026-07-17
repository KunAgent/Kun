#!/usr/bin/env node
/**
 * FBS-BookWriter 开发过程数据清理工具
 * 
 * 目的：清理与用户功能完整性无关的版本修订、开发过程数据
 * 
 * 清理规则：
 * 1. 临时文件和缓存
 * 2. 开发过程审计报告
 * 3. 临时打包目录
 * 4. 重复文件和备份
 * 5. 无效的引用和链接
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 清理规则配置
 */
const CLEANUP_RULES = {
  // 需要删除的文件模式
  patternsToRemove: [
    // 临时文件
    '**/*.tmp',
    '**/*.temp',
    '**/*~',
    '**/*.bak',
    '**/*.backup',
    
    // 开发过程数据
    '**/global-consistency-audit*.md',
    '**/feature-implementation-audit.md',
    '**/audit-report-*.md',
    '**/断链审计*.md',
    '**/修订记录*.md',
    
    // 临时打包目录
    '**/pack-v202-temp',
    '**/pack-v210-temp',
    '**/pack-v211-temp',
    '**/fbs-bookwriter-v211-*-temp',
    '**/temp-pack',
    '**/build-temp',

    
    // 测试输出
    '**/test-output',
    '**/test-results',
    
    // 临时解压目录
    '**/test-unzip',
    '**/unzip-temp'
  ],
  
  // 需要保留的关键文件（即使匹配模式）
  keepFiles: [
    'package.json',
    'package-lock.json',
    'SKILL.md',
    'LICENSE',
    '_plugin_meta.json',
    '_skillhub_meta.json',
    'SMART-MEMORY-ARCHITECTURE.md',
    'v2.0.2-new-features.md',
    'CHANGELOG.md',
    'README-v2.1.1.md',
    'README-v2.1.2.md'

  ],
  
  // 需要保留的目录
  keepDirectories: [
    'FBS-BookWriter',
    'scripts',
    'assets',
    'dist',
    'node_modules',
    'final-test'
  ],
  
  // 最终输出文件
  finalOutput: [
    'fbs-bookwriter-v211-workbuddy.zip',
    'fbs-bookwriter-v211-codebuddy.zip',
    'fbs-bookwriter-v211-openclaw.zip',
    'fbs-bookwriter-team-handoff-v211.zip'
  ]
};


/**
 * 文件清理器
 */
export class DevDataCleaner {
  constructor(projectRoot = path.resolve(__dirname, '..')) {
    this.projectRoot = projectRoot;
    this.cleanupStats = {
      filesDeleted: 0,
      directoriesDeleted: 0,
      spaceFreed: 0,
      errors: []
    };
  }
  
  /**
   * 运行清理
   */
  async cleanup() {
    console.log('═════════════════════════════════════');
    console.log(' FBS-BookWriter 开发数据清理');
    console.log('═════════════════════════════════════\n');
    
    // 1. 清理临时文件
    console.log('[清理] 临时文件...');
    await this.cleanupTemporaryFiles();
    
    // 2. 清理开发过程报告
    console.log('\n[清理] 开发过程报告...');
    await this.cleanupDevReports();
    
    // 3. 清理临时目录
    console.log('\n[清理] 临时目录...');
    await this.cleanupTempDirectories();
    
    // 4. 清理重复文件
    console.log('\n[清理] 重复文件...');
    await this.cleanupDuplicateFiles();
    
    // 5. 验证最终包
    console.log('\n[验证] 最终包完整性...');
    await this.verifyFinalPackage();
    
    this.reportResults();
  }
  
  /**
   * 清理临时文件
   */
  async cleanupTemporaryFiles() {
    const patterns = CLEANUP_RULES.patternsToRemove.filter(p => 
      p.includes('*.tmp') || p.includes('*.temp') || p.includes('*~')
    );
    
    let filesFound = 0;
    const allFiles = this._getAllFiles();
    
    for (const file of allFiles) {
      if (this._shouldDeleteFile(file, patterns)) {
        try {
          const stats = fs.statSync(file);
          fs.unlinkSync(file);
          this.cleanupStats.filesDeleted++;
          this.cleanupStats.spaceFreed += stats.size;
          filesFound++;
          console.log(`  删除: ${path.relative(this.projectRoot, file)}`);
        } catch (error) {
          this.cleanupStats.errors.push({
            file,
            error: error.message
          });
        }
      }
    }
    
    if (filesFound === 0) {
      console.log('  没有发现临时文件');
    }
  }
  
  /**
   * 清理开发过程报告
   */
  async cleanupDevReports() {
    const reportPatterns = CLEANUP_RULES.patternsToRemove.filter(p =>
      p.includes('audit') || p.includes('一致性') || p.includes('断链') || p.includes('修订')
    );
    
    let filesFound = 0;
    const allFiles = this._getAllFiles();
    
    for (const file of allFiles) {
      if (this._shouldDeleteFile(file, reportPatterns)) {
        // 检查是否在dist目录中的最终报告
        const isDist = file.includes(path.join(this.projectRoot, 'dist'));
        const isFinal = file.includes('final') || file.includes('CHANGELOG');
        
        if (isDist && isFinal) {
          console.log(`  保留最终报告: ${path.relative(this.projectRoot, file)}`);
          continue;
        }
        
        try {
          const stats = fs.statSync(file);
          fs.unlinkSync(file);
          this.cleanupStats.filesDeleted++;
          this.cleanupStats.spaceFreed += stats.size;
          filesFound++;
          console.log(`  删除开发报告: ${path.relative(this.projectRoot, file)}`);
        } catch (error) {
          this.cleanupStats.errors.push({
            file,
            error: error.message
          });
        }
      }
    }
    
    if (filesFound === 0) {
      console.log('  没有发现开发过程报告');
    }
  }
  
  /**
   * 清理临时目录
   */
  async cleanupTempDirectories() {
    const dirPatterns = CLEANUP_RULES.patternsToRemove.filter(p =>
      p.includes('temp') || p.includes('Temp') || p.includes('unzip')
    );
    
    const allDirs = this._getAllDirectories();
    
    for (const dir of allDirs) {
      if (this._shouldDeleteDirectory(dir, dirPatterns)) {
        // 特别检查：不要删除项目根目录
        const relativePath = path.relative(this.projectRoot, dir);
        if (relativePath === '.' || relativePath === '') {
          continue;
        }
        
        try {
          const stats = fs.statSync(dir);
          const size = this._getDirectorySize(dir);
          fs.rmSync(dir, { recursive: true, force: true });
          this.cleanupStats.directoriesDeleted++;
          this.cleanupStats.spaceFreed += size;
          console.log(`  删除目录: ${relativePath}`);
        } catch (error) {
          this.cleanupStats.errors.push({
            directory: dir,
            error: error.message
          });
        }
      }
    }
  }
  
  /**
   * 清理重复文件
   */
  async cleanupDuplicateFiles() {
    const distDir = path.join(this.projectRoot, 'dist');
    
    // 清理dist中的重复文件
    if (fs.existsSync(distDir)) {
      const distFiles = fs.readdirSync(distDir);
      const finalPackage = distFiles.find(f => 
        f === 'fbs-bookwriter-v202-workbuddy.zip'
      );

      
      if (finalPackage) {
        // 删除其他旧的zip文件
        const oldPackages = distFiles.filter(f => 
          f.endsWith('.zip') && f !== finalPackage && !f.includes('-platform')
        );
        
        for (const oldPackage of oldPackages) {
          try {
            const oldPackagePath = path.join(distDir, oldPackage);
            const stats = fs.statSync(oldPackagePath);
            fs.unlinkSync(oldPackagePath);
            this.cleanupStats.filesDeleted++;
            this.cleanupStats.spaceFreed += stats.size;
            console.log(`  删除旧包: ${oldPackage}`);
          } catch (error) {
            this.cleanupStats.errors.push({
              file: oldPackage,
              error: error.message
            });
          }
        }
      }
    }
  }
  
  /**
   * 验证最终包
   */
  async verifyFinalPackage() {
    const finalPackage = path.join(this.projectRoot, 'dist/fbs-bookwriter-v202-workbuddy.zip');

    
    if (!fs.existsSync(finalPackage)) {
      console.log('  ⚠️  最终包不存在，需要重新打包');
      return;
    }
    
    const stats = fs.statSync(finalPackage);
    console.log(`  ✅ 最终包存在: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // 检查包内容
    try {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(finalPackage);
      const entries = zip.getEntries();
      
      console.log(`  📦 包含文件: ${entries.length} 个`);
      
      // 检查关键文件
      const requiredFiles = [
        'SKILL.md',
        'package.json',
        '_plugin_meta.json',
        'scripts/smart-memory-natural.mjs',
        'FBS-BookWriter/references/05-ops/search-policy.json'
      ];
      
      const missingFiles = requiredFiles.filter(file => 
        !entries.some(entry => entry.entryName.includes(file))
      );
      
      if (missingFiles.length > 0) {
        console.log(`  ⚠️  缺少关键文件: ${missingFiles.join(', ')}`);
      } else {
        console.log('  ✅ 所有关键文件都在包中');
      }
    } catch (error) {
      console.log(`  ⚠️  无法验证包内容: ${error.message}`);
    }
  }
  
  /**
   * 生成清理报告
   */
  reportResults() {
    console.log('\n═════════════════════════════════════');
    console.log(' 清理报告摘要');
    console.log('═════════════════════════════════════\n');
    
    console.log(`📁 删除文件: ${this.cleanupStats.filesDeleted} 个`);
    console.log(`📂 删除目录: ${this.cleanupStats.directoriesDeleted} 个`);
    console.log(`💾 释放空间: ${(this.cleanupStats.spaceFreed / 1024 / 1024).toFixed(2)} MB`);
    
    if (this.cleanupStats.errors.length > 0) {
      console.log(`\n❌ 错误: ${this.cleanupStats.errors.length} 个`);
      for (const error of this.cleanupStats.errors.slice(0, 5)) {
        console.log(`  - ${error.file || error.directory}: ${error.error}`);
      }
    } else {
      console.log('\n✅ 清理完成，没有错误');
    }
    
    console.log('\n═════════════════════════════════════');
  }
  
  /**
   * 获取所有文件
   */
  _getAllFiles() {
    const files = [];
    
    const scanDirectory = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // 跳过node_modules
        if (entry.name === 'node_modules') {
          continue;
        }
        
        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    };
    
    scanDirectory(this.projectRoot);
    return files;
  }
  
  /**
   * 获取所有目录
   */
  _getAllDirectories() {
    const dirs = [];
    
    const scanDirectory = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // 跳过node_modules
        if (entry.name === 'node_modules') {
          continue;
        }
        
        if (entry.isDirectory()) {
          dirs.push(fullPath);
          scanDirectory(fullPath);
        }
      }
    };
    
    scanDirectory(this.projectRoot);
    return dirs;
  }
  
  /**
   * 检查文件是否应该删除
   */
  _shouldDeleteFile(filePath, patterns) {
    const relativePath = path.relative(this.projectRoot, filePath);
    
    // 检查是否在保留列表中
    for (const keepFile of CLEANUP_RULES.keepFiles) {
      if (relativePath.endsWith(keepFile)) {
        return false;
      }
    }
    
    // 检查是否匹配删除模式
    for (const pattern of patterns) {
      if (this._matchesPattern(relativePath, pattern)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 检查目录是否应该删除
   */
  _shouldDeleteDirectory(dirPath, patterns) {
    const relativePath = path.relative(this.projectRoot, dirPath);
    
    // 检查是否在保留列表中
    for (const keepDir of CLEANUP_RULES.keepDirectories) {
      if (relativePath.startsWith(keepDir)) {
        return false;
      }
    }
    
    // 检查是否匹配删除模式
    for (const pattern of patterns) {
      if (this._matchesPattern(relativePath, pattern)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 模式匹配
   */
  _matchesPattern(str, pattern) {
    // 简单的glob模式匹配
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(str);
  }
  
  /**
   * 获取目录大小
   */
  _getDirectorySize(dirPath) {
    let size = 0;
    
    const scanDirectory = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        } else {
          try {
            const stats = fs.statSync(fullPath);
            size += stats.size;
          } catch (error) {
            // 忽略无法访问的文件
          }
        }
      }
    };
    
    scanDirectory(dirPath);
    return size;
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const cleaner = new DevDataCleaner();
  cleaner.cleanup().catch(console.error);
}

export default DevDataCleaner;
