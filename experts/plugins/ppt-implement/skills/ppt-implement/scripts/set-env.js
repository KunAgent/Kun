#!/usr/bin/env node

const path = require('path');
const os = require('os');
const { createLogger } = require('./lib/logger');

// 创建日志器
const logger = createLogger('set-env');

// 从命令行参数获取
const args = process.argv.slice(2);
let pluginRoot = args[0]; // 获取插件的根目录
let projectDir = args[1]; // 获取工作目录目录
let hookName = args[2]; // 第三个参数

logger.log('[Set Env] 开始设置环境变量...');
logger.log(`[Set Env] 原始参数 CODEBUDDY_PLUGIN_ROOT: ${pluginRoot}`);
logger.log(`[Set Env] 原始参数 CODEBUDDY_PROJECT_DIR: ${projectDir}`);
logger.log(`[Set Env] 原始参数 hookName: ${hookName}`);
