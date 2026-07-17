#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createLogger } = require('./lib/logger');

// 创建日志器
const logger = createLogger('post-slide');

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
 * 将绝对路径转换为相对路径
 * 例如：/path/to/project/frontend/src/slides/slide-1.js -> frontend/src/slides/slide-1.js
 */
function getRelativePath(filePath) {
    if (!filePath) return filePath;
    
    // 标准化路径分隔符
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // 查找 'frontend' 并从那里提取
    if (normalizedPath.includes('/frontend/')) {
        const idx = normalizedPath.indexOf('/frontend/');
        return normalizedPath.substring(idx + 1); // +1 跳过开头的 '/'
    } else if (normalizedPath.endsWith('/frontend')) {
        return 'frontend';
    }
    
    // 如果已经是相对路径
    if (normalizedPath.startsWith('frontend/')) {
        return normalizedPath;
    }
    
    return normalizedPath;
}

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
 * 启动 PPT 预览服务器
 * 条件：文件路径包含 'slides/slide-1.js'
 */
function startServer(relativePath, pluginRoot) {
    // if (!relativePath.includes('slides/slide-1.js')) {
    //     return;
    // }
    // 每次写入内容都时候都重启服务，codebuddy 的hooks 有时候不准确
    const match = relativePath.match(/slides\/slide-\d+\.js$/);
    if (!match) {
        logger.log(`[updateIndexHtml] 忽略更新: ${relativePath}`);
        return;
    }
    
    logger.log(`[startServer] CODEBUDDY_PLUGIN_ROOT: ${pluginRoot}`);
    
    const scriptPath = path.join(pluginRoot, '.genie', 'scripts', 'node', 'process');
    const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
    
    // 后台运行
    const child = spawn(nodeCmd, [scriptPath, 'start', '--restart'], {
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32'
    });
    child.unref();
    
    logger.log('[startServer] 命令已执行');
}

/**
 * 更新 index.html
 * 如果文件路径匹配 slides/slide-\d+.js 模式，在 </body> 前插入 script 标签
 */
function updateIndexHtml(relativePath, projectDir) {
    // 检查文件是否匹配 slides/slide-\d+.js 模式
    const match = relativePath.match(/slides\/slide-\d+\.js$/);
    if (!match) {
        logger.log(`[updateIndexHtml] 忽略更新: ${relativePath}`);
        return;
    }
    
    // 提取相对路径（例如：/src/slides/slide-1.js）
    const slideFile = match[0]; // 例如：slides/slide-1.js
    const srcPath = `/src/${slideFile}`;
    
    const indexHtmlPath = path.join(projectDir, 'frontend', 'index.html');
    
    if (!fs.existsSync(indexHtmlPath)) {
        logger.log(`[updateIndexHtml] index.html 不存在: ${indexHtmlPath}`);
        return;
    }
    
    try {
        let content = fs.readFileSync(indexHtmlPath, 'utf8');
        
        const scriptTag = `<script type="module" src="${srcPath}"></script>`;
        
        // 检查 script 标签是否已存在
        if (content.includes(scriptTag)) {
            logger.log(`[updateIndexHtml] script 标签已存在，跳过: ${srcPath}`);
            return;
        }
        
        // 在 </body> 前插入 script 标签
        content = content.replace('</body>', `    ${scriptTag}\n  </body>`);
        
        fs.writeFileSync(indexHtmlPath, content, 'utf8');
        logger.log(`[updateIndexHtml] 已为 ${srcPath} 添加 script 标签到 index.html`);
    } catch (e) {
        logger.error(`[updateIndexHtml] 更新 index.html 出错: ${e.message}`);
    }
}

/**
 * 更新 pages.json
 * 如果文件路径匹配 slides/slide-\d+.js 模式，更新 docs/pages.json
 */
function updatePagesJson(relativePath, projectDir) {
    // 检查文件是否匹配 slides/slide-\d+.js 模式
    const match = relativePath.match(/slides\/slide-(\d+)\.js$/);
    if (!match) {
        logger.log(`[updatePagesJson] 忽略更新: ${relativePath}`);
        return;
    }
    
    const pageNum = parseInt(match[1], 10);
    
    const docsDir = path.join(projectDir, 'docs');
    const pagesJsonPath = path.join(docsDir, 'pages.json');
    
    // 创建 docs 目录（如果不存在）
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }
    
    // 读取现有的 pages.json 或创建空数组
    let pages = [];
    if (fs.existsSync(pagesJsonPath)) {
        try {
            const content = fs.readFileSync(pagesJsonPath, 'utf8');
            pages = JSON.parse(content);
        } catch (e) {
            pages = [];
        }
    }
    
    // 检查页面条目是否已存在
    const existingPageNums = new Set(pages.map(p => p.pageNum));
    if (existingPageNums.has(pageNum)) {
        return;
    }
    
    // 添加新的页面条目
    const newEntry = {
        pageKey: `ppt-${pageNum}`,
        title: '',
        url: `/index.html?page=${pageNum}`,
        poster: '',
        pageNum: pageNum
    };
    pages.push(newEntry);
    
    // 按 pageNum 排序
    pages.sort((a, b) => (a.pageNum || 0) - (b.pageNum || 0));
    
    // 写入更新后的 pages.json
    try {
        fs.writeFileSync(pagesJsonPath, JSON.stringify(pages, null, 2), 'utf8');
        logger.log(`[updatePagesJson] 已更新 pages.json，添加页面 ${pageNum}`);
    } catch (e) {
        logger.error(`[updatePagesJson] 更新 pages.json 出错: ${e.message}`);
    }
}

/**
 * 主函数
 */
async function main() {
    logger.log(`==== post-slide.js =====`);
    // 从命令行参数获取路径
    const args = process.argv.slice(2);
    const pluginRoot = args[0];
    const projectDir = args[1];

    logger.log('[PPT PostToolUse Hook] 开始执行...');
    logger.log(`[PPT PostToolUse Hook] CODEBUDDY_PLUGIN_ROOT: ${pluginRoot}`);
    logger.log(`[PPT PostToolUse Hook] CODEBUDDY_PROJECT_DIR: ${projectDir}`);

    // 验证参数
    if (!pluginRoot || !projectDir) {
        logger.error('[PPT PostToolUse Hook] 错误: 需要传入 CODEBUDDY_PLUGIN_ROOT 和 CODEBUDDY_PROJECT_DIR 参数');
        logger.error('[PPT PostToolUse Hook] 用法: node post-tool-use.js <CODEBUDDY_PLUGIN_ROOT> <CODEBUDDY_PROJECT_DIR>');
        // 输出空 JSON 对象
        process.exit(0);
    }

    // 从 stdin 读取 JSON，获取 file_path
    let filePath = null;
    try {
        const stdinData = await readStdin();
        logger.debug('[PPT PostToolUse Hook] stdin 数据:', stdinData);
        if (stdinData.trim()) {
            const json = JSON.parse(stdinData);
            filePath = json.tool_input?.file_path || json.file_path;
        }
    } catch (e) {
        logger.warn('[PPT PostToolUse Hook] 警告: 无法解析 stdin 中的 JSON:', e.message);
    }

    // 等待 1 秒（与原脚本行为一致）
    await new Promise(resolve => setTimeout(resolve, 1000));

    logger.log(`[PPT PostToolUse Hook] file_path: ${filePath}`);

    // 检查 file_path 是否有效
    if (!filePath || filePath === 'null' || filePath.trim() === '') {
        logger.log('[PPT PostToolUse Hook] file_path 无效，跳过');
        process.exit(0);
    }

    // 检查项目类型
    if (!checkProjectType(projectDir)) {
        logger.log('[PPT PostToolUse Hook] 项目类型不是 ppt，跳过');
        process.exit(0);
    }

    // 转换为相对路径
    const relativePath = getRelativePath(filePath);
    logger.log(`[PPT PostToolUse Hook] 处理文件: ${relativePath}`);
    const frontendEntryHtmlPath = path.join(projectDir, 'frontend', 'index.html');

    if (filePath === frontendEntryHtmlPath) {
        // 如果入口页index.html文件, 解决index.html与slide-*.js文件的一致性（因为有时候模型在最开始规划的时候就直接批量写入了，导致这时候slide-N.js都没有生成，就开始瞎搞了）
        const slidesDir = path.join(projectDir, 'frontend', 'src', 'slides');
        const slideFiles = fs.readdirSync(slidesDir).filter(f => /^slide-.*\.js$/.test(f));
        // 如果 slide-*.js 文件不存在, 则进行同步，将index.html上加载slide-N.js都干掉
        syncIndexHtmlWithSlides(frontendEntryHtmlPath, slidesDir, slideFiles);
    } else if (filePath.endsWith('.js')) {
        // 处理 JS 文件
        // 执行各项处理
        startServer(relativePath, pluginRoot);
        updateIndexHtml(relativePath, projectDir);
        updatePagesJson(relativePath, projectDir);
    }
}

/**
 * 同步 index.html 与 slide-*.js 文件的一致性
 * 情况1: index.html 引用 slide-N.js，但 slide-N.js 不存在 -> 移除引用
 * 情况2: 存在 slide-N.js，但 index.html 没有引用 -> 添加引用
 * @param {string} indexHtmlPath - index.html 文件路径
 * @param {string} slidesDir - slides 目录路径
 * @param {string[]} slideFiles - 实际存在的 slide 文件列表
 */
function syncIndexHtmlWithSlides(indexHtmlPath, slidesDir, slideFiles) {
    try {
        let content = fs.readFileSync(indexHtmlPath, 'utf8');
        let modified = false;
        
        // 从实际文件列表中提取页码集合
        const existingSlideNums = new Set();
        for (const file of slideFiles) {
            const match = file.match(/^slide-(\d+)\.js$/);
            if (match) {
                existingSlideNums.add(parseInt(match[1], 10));
            }
        }
        
        // 从 index.html 中提取已引用的 slide 页码
        // 匹配模式: <script type="module" src="/src/slides/slide-N.js"></script>
        const scriptTagPattern = /<script\s+type="module"\s+src="\/src\/slides\/slide-(\d+)\.js"><\/script>/g;
        const referencedSlideNums = new Set();
        let match;
        while ((match = scriptTagPattern.exec(content)) !== null) {
            referencedSlideNums.add(parseInt(match[1], 10));
        }
        
        // 情况1: 移除不存在的 slide 引用
        for (const num of referencedSlideNums) {
            if (!existingSlideNums.has(num)) {
                const tagToRemove = `<script type="module" src="/src/slides/slide-${num}.js"></script>`;
                // 移除整行（包括前面的空白和后面的换行）
                const linePattern = new RegExp(`\\s*${escapeRegExp(tagToRemove)}\\n?`, 'g');
                content = content.replace(linePattern, '');
                logger.log(`[syncIndexHtml] 移除不存在的引用: slide-${num}.js`);
                modified = true;
            }
        }
        
        // 情况2: 添加缺失的 slide 引用
        const missingNums = [];
        for (const num of existingSlideNums) {
            if (!referencedSlideNums.has(num)) {
                missingNums.push(num);
            }
        }
        
        if (missingNums.length > 0) {
            // 按页码排序
            missingNums.sort((a, b) => a - b);
            
            // 生成要插入的 script 标签
            const scriptTags = missingNums.map(num => 
                `    <script type="module" src="/src/slides/slide-${num}.js"></script>`
            ).join('\n');
            
            // 在 </body> 前插入
            content = content.replace('</body>', `${scriptTags}\n  </body>`);
            logger.log(`[syncIndexHtml] 添加缺失的引用: ${missingNums.map(n => `slide-${n}.js`).join(', ')}`);
            modified = true;
        }
        
        // 如果有修改，写回文件
        if (modified) {
            fs.writeFileSync(indexHtmlPath, content, 'utf8');
            logger.log('[syncIndexHtml] index.html 已更新');
        } else {
            logger.log('[syncIndexHtml] index.html 无需更新');
        }
    } catch (e) {
        logger.error(`[syncIndexHtml] 同步 index.html 出错: ${e.message}`);
    }
}

/**
 * 转义正则表达式特殊字符
 * @param {string} string - 要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 运行主函数，捕获未处理的异常
main().catch((error) => {
    logger.error('[PPT PostSlide] 未捕获的异常:', error.message);
    logger.error('[PPT PostSlide] 错误堆栈:', error.stack);
    process.exit(1);
});
