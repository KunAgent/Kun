#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createLogger } = require('./lib/logger');

// 创建日志器
const logger = createLogger('setup-project');

/**
 * 从 stdin 读取数据
 */
function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        
        // 设置超时，避免无限等待
        const timeout = setTimeout(() => {
            resolve(data);
        }, 1000);
        
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => {
            clearTimeout(timeout);
            resolve(data);
        });
        process.stdin.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

/**
 * 递归复制目录
 */
function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) {
        logger.error(`[PPT Setup] 源目录不存在: ${src}`);
        return;
    }
    
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * 运行 npm install
 */
function runNpmInstall(dir) {
    logger.log(`[PPT Setup] 正在运行 npm install: ${dir}...`);
    try {
        execSync(`npm install`, {
            cwd: dir,
            stdio: 'ignore'
        });
        logger.log('[PPT Setup] npm install 完成');
    } catch (error) {
        logger.error('[PPT Setup] npm install 失败:', error.message);
    }
}

/**
 * 合并 .cloudstudio 配置文件
 * 如果目标文件已存在，则将模板内容追加到现有内容后面
 * 如果目标文件不存在，则直接复制模板文件
 * @param {string} templatePath - 模板文件路径
 * @param {string} destPath - 目标文件路径
 */
function mergeCloudstudioConfig(templatePath, destPath) {
    if (!fs.existsSync(templatePath)) {
        logger.warn(`[PPT Setup] .cloudstudio 模板文件不存在: ${templatePath}`);
        return;
    }
    
    logger.log(`[PPT Setup] 正在处理 .cloudstudio 配置文件...`);
    
    // 检查目标文件是否已存在
    if (fs.existsSync(destPath)) {
        // 存在则合并：当前文件内容 + 两个换行 + 模板文件内容
        const currentContent = fs.readFileSync(destPath, 'utf8');
        const templateContent = fs.readFileSync(templatePath, 'utf8');
        const mergedContent = currentContent + '\n\n' + templateContent;
        
        fs.writeFileSync(destPath, mergedContent, 'utf8');
        logger.log('[PPT Setup] .cloudstudio 配置文件已合并');
    } else {
        // 不存在则直接复制模板文件
        fs.copyFileSync(templatePath, destPath);
        logger.log('[PPT Setup] .cloudstudio 配置文件已从模板创建');
    }
}

/**
 * 执行 setup 逻辑
 */
function runSetup(pluginRoot, projectDir, genieTemplatePath) {
    try {
        const frontendDir = path.join(projectDir, 'frontend');
        
        // 判断 CODEBUDDY_PROJECT_DIR 下是否有 frontend 目录
        if (!fs.existsSync(frontendDir)) {
            logger.log('[PPT Setup] 正在初始化项目...');
            // 复制 frontend 模板目录
            const frontendTemplate = genieTemplatePath ? path.join(genieTemplatePath, 'ppt', 'frontend') : path.join(pluginRoot, 'skills', 'ppt-implement', 'templates', 'frontend');
            logger.log(`[PPT Setup] 正在复制 frontend 模板: ${frontendTemplate}, 目标：${frontendDir}`);
            copyDirSync(frontendTemplate, frontendDir);
            
            // 合并 .cloudstudio 配置文件
            const cloudstudioTemplate = genieTemplatePath? path.join(genieTemplatePath, 'ppt', '.cloudstudio') : path.join(pluginRoot, 'skills', 'ppt-implement', 'templates', '.cloudstudio');
            const cloudstudioDest = path.join(projectDir, '.cloudstudio');
            mergeCloudstudioConfig(cloudstudioTemplate, cloudstudioDest);
            
            // 运行 npm install
            runNpmInstall(frontendDir);
            
            const exportSdkDir = path.join(pluginRoot, 'skills', 'ppt-implement', 'scripts', 'export');
            // 对导出pptx安装必须的依赖
            runNpmInstall(exportSdkDir);

            if (genieTemplatePath) {
                // 清理临时模板目录 genieTemplatePath
                if (fs.existsSync(genieTemplatePath)) {
                    fs.rmSync(genieTemplatePath, { recursive: true, force: true });
                    logger.log(`[PPT Setup] 已清理临时模板目录: ${genieTemplatePath}`);
                }
            }
        } else {
            logger.log('[PPT Setup] frontend 目录已存在，跳过复制');
        }
        
        // 创建 docs 目录（如果不存在）
        const docsDir = path.join(projectDir, 'docs');
        if (!fs.existsSync(docsDir)) {
            fs.mkdirSync(docsDir, { recursive: true });
        }
        
        // 写入 project.json
        const projectJsonPath = path.join(docsDir, 'project.json');
        const projectJson = {
            project_type: 'ppt',
            sub_project_type: 'ppt'
        };
        fs.writeFileSync(projectJsonPath, JSON.stringify(projectJson, null, 2));
        logger.log(`[PPT Setup] 已写入: ${projectJsonPath}`);
        
        logger.log('[PPT Setup] 初始化完成！');
    } catch (error) {
        logger.error('[PPT Setup] 错误:', error.message);
        process.exit(1);
    }
}

/**
 * 主函数
 */
async function main() {
    logger.log(`==== setup-project.js =====`);
    // 从命令行参数获取路径
    const args = process.argv.slice(2);
    const pluginRoot = args[0];
    const projectDir = args[1];
    const genieTemplatePath = args[2];

    // 验证参数
    if (!pluginRoot || !projectDir) {
        logger.error('[PPT Setup] 错误: 需要传入 CODEBUDDY_PLUGIN_ROOT 和 CODEBUDDY_PROJECT_DIR 参数');
        logger.error('[PPT Setup] 用法: node setup.js <CODEBUDDY_PLUGIN_ROOT> <CODEBUDDY_PROJECT_DIR>');
        process.exit(1);
    }

    // 从 stdin 读取 JSON
    let skill = null;
    try {
        const stdinData = await readStdin();
        logger.debug('[PPT Setup] stdin 数据:', stdinData);
        if (stdinData.trim()) {
            const json = JSON.parse(stdinData);
            skill = json.tool_input?.skill || json.skill;
        }
    } catch (e) {
        logger.warn('[PPT Setup] 警告: 无法解析 stdin 中的 JSON:', e.message);
    }

    logger.log(`[PPT Setup] skill: ${skill}`);

    // 只在 skill === 'ppt-implement' 时执行
    if (skill !== 'ppt-implement') {
        logger.log(`[PPT Setup] 跳过: skill 是 "${skill}"，不是 "ppt-implement"`);
        process.exit(0);
    }

    logger.log('[PPT Setup] 开始执行 ppt-implement skill 初始化...');
    logger.log(`[PPT Setup] CODEBUDDY_PLUGIN_ROOT: ${pluginRoot}`);
    logger.log(`[PPT Setup] CODEBUDDY_PROJECT_DIR: ${projectDir}`);
    logger.log(`[PPT Setup] genieTemplatePath: ${genieTemplatePath}`);

    // 执行 setup
    runSetup(pluginRoot, projectDir, genieTemplatePath);
}

// 运行主函数，捕获未处理的异常
main().catch((error) => {
    logger.error('[PPT Setup] 未捕获的异常:', error.message);
    logger.error('[PPT Setup] 错误堆栈:', error.stack);
    process.exit(1);
});
