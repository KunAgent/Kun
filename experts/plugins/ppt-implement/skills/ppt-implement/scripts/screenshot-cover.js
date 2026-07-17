#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createLogger } = require('./lib/logger');

// 创建日志器
const logger = createLogger('screenshot-cover');

/**
 * 检查项目类型是否为 'ppt'
 */
function checkProjectType(projectDir) {
    const projectJsonPath = path.join(projectDir, 'docs', 'project.json');
    
    if (!fs.existsSync(projectJsonPath)) {
        return false;
    }
    
    try {
        const content = fs.readFileSync(projectJsonPath, 'utf8');
        const projectConfig = JSON.parse(content);
        return projectConfig.project_type === 'ppt';
    } catch (e) {
        return false;
    }
}

/**
 * 截取 PPT 首页截图
 */
function captureScreenshot(pluginRoot, projectDir) {
    logger.log(`[截图] CODEBUDDY_PLUGIN_ROOT: ${pluginRoot}`);
    logger.log(`[截图] CODEBUDDY_PROJECT_DIR: ${projectDir}`);
    
    const scriptPath = path.join(pluginRoot, '.genie', 'scripts', 'python', 'capture_screenshot.py');
    
    // 确保 posters 目录存在
    const postersDir = path.join(projectDir, 'docs', 'posters', 'app');
    if (!fs.existsSync(postersDir)) {
        fs.mkdirSync(postersDir, { recursive: true });
    }
    
    const outputPath = path.join(postersDir, 'app-poster.png');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    // 检查 Python 截图脚本是否存在
    if (!fs.existsSync(scriptPath)) {
        logger.log(`[截图] Python 脚本不存在: ${scriptPath}`);
        return;
    }
    
    // 后台运行
    const child = spawn(pythonCmd, [scriptPath, outputPath], {
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32'
    });
    child.unref();
    
    logger.log(`[截图] 命令已执行，输出路径: ${outputPath}`);
}

/**
 * 主函数
 */
async function main() {
    logger.log(`==== screenshot-cover.js =====`);
    // 从命令行参数获取路径
    const args = process.argv.slice(2);
    const pluginRoot = args[0];
    const projectDir = args[1];

    logger.log('[PPT 截图] 开始执行...');

    // 验证参数
    if (!pluginRoot || !projectDir) {
        logger.error('[PPT 截图] 错误: 需要传入 CODEBUDDY_PLUGIN_ROOT 和 CODEBUDDY_PROJECT_DIR 参数');
        logger.error('[PPT 截图] 用法: node screenshot-cover.js <CODEBUDDY_PLUGIN_ROOT> <CODEBUDDY_PROJECT_DIR>');
        process.exit(1);
    }

    logger.log(`[PPT 截图] CODEBUDDY_PLUGIN_ROOT: ${pluginRoot}`);
    logger.log(`[PPT 截图] CODEBUDDY_PROJECT_DIR: ${projectDir}`);

    // 检查项目类型，只有 ppt 项目才进行截图
    if (!checkProjectType(projectDir)) {
        logger.log('[PPT 截图] 项目类型不是 ppt，跳过截图');
        process.exit(0);
    }

    logger.log('[PPT 截图] 项目类型是 ppt，开始截图...');
    
    // 执行截图
    captureScreenshot(pluginRoot, projectDir);
    
    logger.log('[PPT 截图] 完成');
}

// 运行主函数
main().catch((error) => {
    logger.error('[PPT screenshot-cover] 未捕获的异常:', error.message);
    logger.error('[PPT screenshot-cover] 错误堆栈:', error.stack);
    process.exit(1);
})
