/**
 * HTML 转 PPTX 工具
 * 支持多幻灯片 HTML 文件（每个 .slide-page div 是一个幻灯片）
 * 基于 Anthropics 官方的 html2pptx_official.js 实现
 *
 * 注意：PptxGenJS 是 html2pptx_official.js 的必需依赖，用于创建和保存 PPTX 文件
 */

const html2pptx = require('./html2pptx_official');
const fs = require('fs');
const path = require('path');
// PptxGenJS 是 html2pptx_official.js 的必需依赖
const pptxgen = require('pptxgenjs');

// ============================================================================
// 日志工具：根据 isDebug 参数控制日志输出
// ============================================================================
let _isDebug = false;

/**
 * 设置调试模式
 * @param {boolean} debug - 是否启用调试模式
 */
function setDebugMode(debug) {
    _isDebug = debug;
}

/**
 * 日志工具对象
 * - log: 仅在 isDebug=true 时输出
 * - warn: 仅在 isDebug=true 时输出
 * - error: 始终输出
 */
const logger = {
    log: (...args) => {
        if (_isDebug) {
            console.log(...args);
        }
    },
    warn: (...args) => {
        if (_isDebug) {
            console.warn(...args);
        }
    },
    error: (...args) => {
        console.error(...args);
    }
};

/**
 * 将 HTML 文件转换为 PPTX 文件
 *
 * @param {string} htmlFilePath - HTML 文件路径
 * @param {string} outputPptxPath - 输出 PPTX 文件路径
 * @param {Object} options - 可选配置
 * @param {boolean} options.isDebug - 是否启用调试模式（默认 false）
 *                                    true: 打印所有日志（log, warn, error）
 *                                    false: 仅打印 error 日志
 * @returns {Promise<Object>} 转换结果 { 
 *   success: boolean, 
 *   outputPath: string, 
 *   slideCount: number,
 *   statistics: {
 *     total: number,
 *     success: number,
 *     failed: number,
 *     failedSlides: Array<{index: number, error: string}>
 *   }
 * }
 */
async function htmlToPptx(htmlFilePath, outputPptxPath, options = {}) {
    const { isDebug = false } = options;
    
    // 设置调试模式
    setDebugMode(isDebug);

    // 检查 HTML 文件是否存在
    if (!fs.existsSync(htmlFilePath)) {
        throw new Error(`HTML 文件不存在: ${htmlFilePath}`);
    }

    // 读取 HTML 文件
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');

    // 提取样式表
    const styles = extractStyles(htmlContent);

    // 解析 HTML，提取每个 slide-page
    const slidePages = extractSlidePages(htmlContent);

    if (slidePages.length === 0) {
        throw new Error('HTML 文件中没有找到幻灯片（.slide-page div）');
    }

    // 创建临时目录用于存储单个幻灯片的 HTML 文件
    // 支持批量处理：基于HTML文件名生成唯一的临时文件夹名，避免多个文件处理时相互覆盖
    // 文件夹名不再以.开头，避免在操作系统中隐藏
    const htmlFileName = path.basename(htmlFilePath, path.extname(htmlFilePath));
    // 如果HTML文件名包含后缀（如 _slides），提取基础文件名
    const baseFileName = htmlFileName.replace(/_slides$/, '');
    // 生成唯一的临时文件夹名：html2pptx_tmp_<基础文件名>
    const tmpDirName = `html2pptx_tmp_${baseFileName}`;
    const tmpDir = path.join(path.dirname(htmlFilePath), tmpDirName);
    fs.mkdirSync(tmpDir, {recursive: true});
    
    // 检查 HTML 内容中是否有相对路径的图片引用，如果有则尝试复制 assets 目录
    // 这样在临时目录中处理时图片能正确加载
    const hasRelativeAssets = htmlContent.includes('src="assets/') || htmlContent.includes("src='assets/");
    if (hasRelativeAssets) {
        // 尝试从多个可能的位置查找 assets 目录
        const possibleAssetsDirs = [
            path.join(path.dirname(htmlFilePath), 'assets'),  // 同目录下的 assets
            path.join(path.dirname(htmlFilePath), '..', 'frontend', 'dist-slides', 'assets'),  // frontend/dist-slides/assets
            path.join(path.dirname(htmlFilePath), '..', 'frontend', 'public', 'assets'),  // frontend/public/assets
        ];
        
        for (const assetsDir of possibleAssetsDirs) {
            if (fs.existsSync(assetsDir)) {
                const targetAssetsDir = path.join(tmpDir, 'assets');
                try {
                    fs.cpSync(assetsDir, targetAssetsDir, { recursive: true });
                    logger.log(`📁 已复制 assets 目录到临时目录: ${targetAssetsDir}`);
                } catch (e) {
                    logger.error(`⚠️  复制 assets 目录失败: ${e.message}`);
                }
                break;
            }
        }
    }

    // 创建 PPTX 演示文稿
    // html2pptx_official.js 需要 PptxGenJS 实例来添加幻灯片和保存文件
    const pptx = new pptxgen();
    // 16:9 比例：15英寸 x 8.4375英寸 = 1440px x 810px (96 DPI) - 匹配原始HTML尺寸
    pptx.defineLayout({name: 'LAYOUT_16x9', width: 15, height: 8.4375});
    pptx.layout = 'LAYOUT_16x9'; // 16:9 宽屏布局

    // 统计信息：记录每个幻灯片的转换结果
    const statistics = {
        total: slidePages.length,
        success: 0,
        failed: 0,
        failedSlides: [] // 格式: [{index: number, error: string}]
    };

    try {
        // 为每个幻灯片创建单独的 HTML 文件并使用官方 html2pptx 转换
        for (let i = 0; i < slidePages.length; i++) {
            const slideHtml = slidePages[i];

            // 自动修复 HTML 中的常见错误（规则2和规则3）
            const fixedSlideHtml = fixHtmlErrors(slideHtml);
            
            // 创建完整的 HTML 文档（单个幻灯片）
            const fullHtml = wrapSlideHtml(fixedSlideHtml, styles);

            // 保存为临时 HTML 文件
            const tempHtmlPath = path.join(tmpDir, `slide_${i}.html`);
            fs.writeFileSync(tempHtmlPath, fullHtml, 'utf-8');

            // 使用官方的 html2pptx 转换
            // 不进行自动调整或缩放，溢出内容可能显示不完整但会继续生成
            try {
                const {slide, warnings} = await html2pptx(tempHtmlPath, pptx, {
                    tmpDir: tmpDir,
                    isDebug: isDebug
                });
                // slide 已经添加到 pptx 中
                
                // 检查是否有溢出警告
                const overflowWarnings = warnings?.filter(w => 
                    w.includes('overflows body') || 
                    w.includes('ends too close to bottom edge') ||
                    w.includes('too close to bottom')
                ) || [];
                
                if (overflowWarnings.length > 0) {
                    logger.warn(`⚠️  第 ${i + 1} 个幻灯片有溢出警告（已生成，可能显示不完整）:`);
                    overflowWarnings.forEach(w => logger.warn(`     ${w}`));
                } else {
                    logger.log(`✅ 成功转换第 ${i + 1} 个幻灯片`);
                }
                statistics.success++;
            } catch (error) {
                const errorMessage = error.message || '未知错误';
                logger.error(`❌ 转换第 ${i + 1} 个幻灯片时出错: ${errorMessage}`);
                if (error.stack && _isDebug) {
                    logger.log(`   错误堆栈: ${error.stack}`);
                }
                // 记录失败的幻灯片信息
                statistics.failed++;
                statistics.failedSlides.push({
                    index: i + 1, // 幻灯片编号（从1开始）
                    error: errorMessage
                });
            }
        }

        // 确保输出目录存在
        fs.mkdirSync(path.dirname(outputPptxPath), {recursive: true});

        // 保存 PPTX 文件
        await pptx.writeFile({fileName: outputPptxPath});

        // 输出统计信息
        logger.log('\n📊 PPTX 转换统计:');
        logger.log(`   总幻灯片数: ${statistics.total}`);
        logger.log(`   ✅ 成功: ${statistics.success}`);
        logger.log(`   ❌ 失败: ${statistics.failed}`);
        if (statistics.failed > 0) {
            logger.log(`\n   失败的幻灯片:`);
            statistics.failedSlides.forEach(slide => {
                logger.log(`      - 第 ${slide.index} 页: ${slide.error}`);
            });
        }
        logger.log(''); // 空行分隔

        return {
            success: true,
            outputPath: outputPptxPath,
            slideCount: pptx.slides.length,
            statistics: statistics
        };

    } catch (error) {
        // 清理临时文件
        try {
            fs.rmSync(tmpDir, {recursive: true, force: true});
        } catch (e) {
            // 忽略清理错误
        }
        throw error;
    }
}

/**
 * 自动修复 HTML 中的常见错误
 * 根据 SKILL.md 中的规则2和规则3进行自动修复
 * 
 * 修复内容：
 * 1. div 中未包装的文本（规则2）：将 div 中的直接文本节点包装在 <p> 标签中
 * 2. 错误的标签嵌套（规则3）：修复 <p> 和 <h1>-<h6> 的互相嵌套、<ul>/<ol> 中包含非 <li> 元素等
 * 
 * @param {string} htmlContent - 原始 HTML 内容
 * @returns {string} 修复后的 HTML 内容
 */
function fixHtmlErrors(htmlContent) {
    let fixedHtml = htmlContent;
    
    // ========================================================================
    // 修复1：div 中未包装的文本（规则2）
    // ========================================================================
    // 使用多次遍历的方法，逐步修复所有 div 中未包装的文本
    
    let previousHtml = '';
    let iterations = 0;
    const maxIterations = 10; // 防止无限循环
    
    while (fixedHtml !== previousHtml && iterations < maxIterations) {
        previousHtml = fixedHtml;
        iterations++;
        
        // 修复1.1：简单的单层 div，直接包含文本（不包含其他标签）
        // 匹配 <div...>纯文本</div>，其中纯文本不包含 < 字符
        fixedHtml = fixedHtml.replace(/<div([^>]*)>([^<]+?)<\/div>/gi, (match, attributes, textContent) => {
            const trimmedText = textContent.trim();
            if (!trimmedText) return match;
            // 如果文本不包含任何标签，包装在 <p> 中
            if (!trimmedText.includes('<')) {
                return `<div${attributes}><p>${trimmedText}</p></div>`;
            }
            return match;
        });
        
        // 修复1.2：div 开始标签后直接跟着文本，然后跟着其他标签的情况
        // 例如：<div class="xxx">文本<h1>标题</h1></div> -> <div class="xxx"><p>文本</p><h1>标题</h1></div>
        fixedHtml = fixedHtml.replace(/<div([^>]*)>([^<\s][^<]*?)(<[^/])/gi, (match, attributes, textContent, nextTag) => {
            const trimmedText = textContent.trim();
            if (trimmedText && !trimmedText.includes('<')) {
                return `<div${attributes}><p>${trimmedText}</p>${nextTag}`;
            }
            return match;
        });
    }
    
    // ========================================================================
    // 修复2：错误的标签嵌套（规则3）
    // ========================================================================
    
    // 修复2.1：<p> 和 <h1>-<h6> 的互相嵌套
    // <p><h1>标题</h1></p> -> <h1>标题</h1>
    fixedHtml = fixedHtml.replace(/<p[^>]*>(<h[1-6][^>]*>.*?<\/h[1-6]>)<\/p>/gi, '$1');
    // <h1><p>段落</p></h1> -> <h1>段落</h1>
    fixedHtml = fixedHtml.replace(/<(h[1-6])[^>]*>(<p[^>]*>)(.*?)(<\/p>)(<\/h[1-6]>)/gi, '<$1>$3</$5>');
    // <p><p>段落</p></p> -> <p>段落</p>
    fixedHtml = fixedHtml.replace(/<p[^>]*>(<p[^>]*>.*?<\/p>)<\/p>/gi, '$1');
    
    // 修复2.2：<ul>/<ol> 中包含非 <li> 元素
    // <ul><p>项目</p></ul> -> <ul><li>项目</li></ul>
    fixedHtml = fixedHtml.replace(/<(ul|ol)[^>]*>(<p[^>]*>)(.*?)(<\/p>)(<\/\1>)/gi, '<$1><li>$3</li></$5>');
    // <ul><h1>标题</h1></ul> -> <ul><li>标题</li></ul>
    fixedHtml = fixedHtml.replace(/<(ul|ol)[^>]*>(<h[1-6][^>]*>)(.*?)(<\/h[1-6]>)(<\/\1>)/gi, '<$1><li>$3</li></$5>');
    
    // 修复2.3：<li> 中包含块级文本标签
    // <li><p>项目内容</p></li> -> <li>项目内容</li>
    fixedHtml = fixedHtml.replace(/<li[^>]*>(<p[^>]*>)(.*?)(<\/p>)(<\/li>)/gi, '<li>$2</li>');
    // <li><h1>标题</h1></li> -> <li>标题</li>
    fixedHtml = fixedHtml.replace(/<li[^>]*>(<h[1-6][^>]*>)(.*?)(<\/h[1-6]>)(<\/li>)/gi, '<li>$2</li>');
    
    return fixedHtml;
}

/**
 * 从 HTML 内容中提取样式表
 */
function extractStyles(htmlContent) {
    const styleMatch = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    return styleMatch ? styleMatch[1] : '';
}

/**
 * 从 HTML 内容中提取所有 slide-page div
 * 提取整个div元素（包括class和样式），以便保留padding等样式
 * 使用嵌套div匹配算法，正确处理嵌套的div标签
 */
function extractSlidePages(htmlContent) {
    const slidePages = [];

    // 查找所有包含 slide-page class 的 div 开始标签
    const slideStartRegex = /<div[^>]*class=["'][^"']*slide-page[^"']*["'][^>]*>/gi;
    let startMatch;

    while ((startMatch = slideStartRegex.exec(htmlContent)) !== null) {
        const startIndex = startMatch.index;
        const startTag = startMatch[0];
        const startTagEndIndex = startIndex + startTag.length;

        // 从开始标签之后开始查找匹配的结束标签
        // 需要计算嵌套的div深度
        let depth = 1;
        let currentIndex = startTagEndIndex;
        let endIndex = -1;

        while (currentIndex < htmlContent.length && depth > 0) {
            // 查找下一个 <div 或 </div>
            // 使用正则表达式确保匹配真正的div标签（后面跟着空格、>或属性字符）
            const divStartRegex = /<div[\s>]/g;
            divStartRegex.lastIndex = currentIndex;
            const divStartMatch = divStartRegex.exec(htmlContent);
            const nextDivStart = divStartMatch ? divStartMatch.index : -1;
            
            const nextDivEnd = htmlContent.indexOf('</div>', currentIndex);

            // 如果都找不到，说明没有匹配的结束标签
            if (nextDivStart === -1 && nextDivEnd === -1) {
                break;
            }

            // 判断哪个更近
            if (nextDivEnd === -1 || (nextDivStart !== -1 && nextDivStart < nextDivEnd)) {
                // 找到了一个开始标签，增加深度
                // 需要检查这是否是一个自闭合标签（如 <div />）
                const tagEnd = htmlContent.indexOf('>', nextDivStart);
                if (tagEnd !== -1) {
                    const tagContent = htmlContent.substring(nextDivStart, tagEnd + 1);
                    // 检查是否是自闭合标签
                    if (!tagContent.endsWith('/>')) {
                        depth++;
                    }
                    currentIndex = tagEnd + 1;
                } else {
                    currentIndex = nextDivStart + 4;
                }
            } else {
                // 找到了一个结束标签，减少深度
                depth--;
                if (depth === 0) {
                    endIndex = nextDivEnd + 6; // 6 是 '</div>' 的长度
                    break;
                }
                currentIndex = nextDivEnd + 6;
            }
        }

        if (endIndex !== -1) {
            // 提取完整的div元素（包括开始标签和内容）
            const fullMatch = htmlContent.substring(startIndex, endIndex);
            slidePages.push(fullMatch);
        }
    }

    // 如果没有找到 slide-page，尝试提取 body 内容
    if (slidePages.length === 0) {
        const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            slidePages.push(bodyMatch[1]);
        }
    }

    return slidePages;
}

/**
 * 将单个幻灯片的 HTML 包装成完整的 HTML 文档
 * 根据官方规范，body 必须有明确的尺寸
 * 16:9 比例：1440px x 810px = 15英寸 x 8.4375英寸 (96 DPI)
 * 对应 PowerPoint 16:9 标准尺寸
 * 
 * 重要：必须保留原始body的padding设置，确保边距正确应用
 * 重要：必须保留原始的font-family设置，默认使用 TencentSans
 * 
 * @param {string} slideHtml - 幻灯片HTML内容
 * @param {string} originalStyles - 原始样式表
 */
function wrapSlideHtml(slideHtml, originalStyles = '') {
    // 从原始HTML的样式中提取padding值，用于设置slide-page的margin
    // 重要：原始HTML中padding可能在body或.slide-page上，都会被转换为slide-page的margin
    // 
    // 工作流程：
    // 1. 优先从.slide-page样式中提取padding（更常见）
    // 2. 如果没有，则从body样式中提取padding
    // 3. 在转换后的HTML中，body的padding设为0，slide-page的margin设为提取的值
    // 4. 这样html2pptx_official.js转换时，边距不会被重复应用
    
    // 初始化默认值（如果原始HTML没有padding，将使用这些默认值）
    // 默认50px（缩小边距，给内容更多空间，但仍满足最小边距要求48px）
    let marginTop = '50px', marginRight = '50px', marginBottom = '50px', marginLeft = '50px';
    
    // 提取padding值的辅助函数
    const extractPadding = (styleContent) => {
        if (!styleContent) return null;
        
        // 尝试提取padding值（支持多种格式：padding: 60px 60px; 或 padding-top: 60px; 等）
        const paddingMatch = styleContent.match(/padding:\s*([^;]+)/i);
        if (paddingMatch) {
            // 解析padding简写：可能是 1-4 个值
            const values = paddingMatch[1].trim().split(/\s+/);
            if (values.length === 1) {
                return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
            } else if (values.length === 2) {
                return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
            } else if (values.length === 3) {
                return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
            } else if (values.length === 4) {
                return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
            }
        } else {
            // 如果没有简写形式，尝试提取各个方向的padding
            const paddingTop = styleContent.match(/padding-top:\s*([^;]+)/i)?.[1]?.trim();
            const paddingRight = styleContent.match(/padding-right:\s*([^;]+)/i)?.[1]?.trim();
            const paddingBottom = styleContent.match(/padding-bottom:\s*([^;]+)/i)?.[1]?.trim();
            const paddingLeft = styleContent.match(/padding-left:\s*([^;]+)/i)?.[1]?.trim();
            
            if (paddingTop || paddingRight || paddingBottom || paddingLeft) {
                return {
                    top: paddingTop || marginTop,
                    right: paddingRight || marginRight,
                    bottom: paddingBottom || marginBottom,
                    left: paddingLeft || marginLeft
                };
            }
        }
        return null;
    };
    
    // 优先从.slide-page样式中提取padding（更常见的情况）
    const slidePageStyleMatch = originalStyles.match(/\.slide-page\s*\{([^}]*)\}/i);
    if (slidePageStyleMatch) {
        const slidePageStyleContent = slidePageStyleMatch[1];
        const padding = extractPadding(slidePageStyleContent);
        if (padding) {
            marginTop = padding.top;
            marginRight = padding.right;
            marginBottom = padding.bottom;
            marginLeft = padding.left;
        }
    }
    
    // 如果没有从.slide-page中找到，则尝试从body样式中提取
    if (marginTop === '50px' && marginRight === '50px' && marginBottom === '50px' && marginLeft === '50px') {
        const bodyStyleMatch = originalStyles.match(/body\s*\{([^}]*)\}/i);
        if (bodyStyleMatch) {
            const bodyStyleContent = bodyStyleMatch[1];
            const padding = extractPadding(bodyStyleContent);
            if (padding) {
                marginTop = padding.top;
                marginRight = padding.right;
                marginBottom = padding.bottom;
                marginLeft = padding.left;
            }
        }
    }
    // 使用提取的值（如果原始HTML有padding）或默认值（如果原始HTML没有padding）
    // 构建slide-page的margin字符串
    const slidePageMargin = `${marginTop} ${marginRight} ${marginBottom} ${marginLeft}`;
    
    // 提取字体设置（从body样式中）
    // 默认使用 TencentSans 作为首选字体，回退到 Arial
    let fontFamily = 'TencentSans, Arial, sans-serif';
    const bodyStyleMatch = originalStyles.match(/body\s*\{([^}]*)\}/i);
    if (bodyStyleMatch) {
        const fontFamilyMatch = bodyStyleMatch[1].match(/font-family:\s*([^;]+)/i);
        if (fontFamilyMatch) {
            fontFamily = fontFamilyMatch[1].trim();
        }
    }
    
    // 设置body尺寸
    // 标准尺寸：1440x810px (15英寸 x 8.4375英寸 @ 96 DPI) - 匹配原始HTML
    const bodyWidth = 1440;
    const bodyHeight = 810;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Slide</title>
    <style>
        html {
            background: #ffffff;
        }
        body {
            width: ${bodyWidth}px;
            height: ${bodyHeight}px;
            margin: 0;
            padding: 0; /* 不在body上设置padding，避免边距被重复应用 */
            box-sizing: border-box;
            font-family: ${fontFamily}; /* 使用从原始样式提取的字体，默认 TencentSans */
            display: flex; /* 使用flex防止margin collapse */
            overflow: hidden; /* 防止内容溢出 */
        }
        /* 原始样式，但需要调整：
           1. 移除body样式（由上面的body定义）
           2. 调整slide-page尺寸和边距
        */
        ${originalStyles
            .replace(/body\s*\{[^}]*\}/gi, '') // 移除body样式定义（已在上面的body中定义）
            .replace(/\.slide-page\s*\{[^}]*\}/gi, (match) => {
                // 清理slide-page样式：调整尺寸，移除padding（将使用margin代替）
                let cleaned = match
                    // 调整尺寸（移除固定尺寸，使用100%）
                    .replace(/width:\s*\d+px[^;]*;?/gi, 'width: 100%;')
                    .replace(/height:\s*\d+px[^;]*;?/gi, 'height: 100%;')
                    .replace(/box-sizing[^;]*;?/gi, 'box-sizing: border-box;')
                    // 移除所有padding相关属性（将使用margin代替）
                    .replace(/padding:\s*[^;]+;?/gi, '')
                    .replace(/padding-top:\s*[^;]+;?/gi, '')
                    .replace(/padding-right:\s*[^;]+;?/gi, '')
                    .replace(/padding-bottom:\s*[^;]+;?/gi, '')
                    .replace(/padding-left:\s*[^;]+;?/gi, '')
                    // 清理多余的分号和空格
                    .replace(/;\s*;/g, ';')  // 连续的分号
                    .replace(/\{\s*;/g, '{')  // 开括号后的分号
                    .replace(/;\s*\}/g, '}'); // 闭括号前的分号
                return cleaned;
            })}
        /* 确保slide-page div适应body，并设置margin来实现边距 */
        /* 重要：使用margin而不是padding，避免被html2pptx_official.js转换为margin导致边距放大 */
        /* html2pptx_official.js会将元素的padding转换为margin，但margin会直接使用，不会重复应用 */
        /* slide-page的尺寸需要减去margin，避免超出body */
        .slide-page {
            width: calc(100% - ${marginLeft} - ${marginRight}) !important;
            height: calc(100% - ${marginTop} - ${marginBottom}) !important;
            box-sizing: border-box !important;
            margin: ${slidePageMargin} !important; /* 使用margin实现边距，避免重复应用 */
        }
        /* 对于没有特殊display属性的slide-page，使用block布局 */
        .slide-page:not(.cover):not([style*="display"]) {
            display: block !important;
        }
    </style>
</head>
<body>
${slideHtml}
</body>
</html>`;
}

// 导出函数
module.exports = {htmlToPptx};

// 命令行入口
if (require.main === module) {
    const args = process.argv.slice(2);
    
    // 解析参数
    let htmlFilePath = null;
    let outputPptxPath = null;
    let isDebug = false;
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--debug' || arg === '-d') {
            isDebug = true;
        } else if (arg.startsWith('--debug=')) {
            isDebug = arg.split('=')[1].toLowerCase() === 'true';
        } else if (!htmlFilePath) {
            htmlFilePath = arg;
        } else if (!outputPptxPath) {
            outputPptxPath = arg;
        }
    }
    
    if (!htmlFilePath || !outputPptxPath) {
        console.error('错误: 参数不足');
        console.error('使用方法: node html2pptx.js <html_file_path> <output_pptx_path> [--debug]');
        console.error('');
        console.error('参数说明:');
        console.error('  <html_file_path>    - HTML 文件路径');
        console.error('  <output_pptx_path>  - 输出 PPTX 文件路径');
        console.error('  --debug, -d         - 启用调试模式，打印所有日志');
        console.error('  --debug=true/false  - 显式设置调试模式');
        process.exit(1);
    }

    htmlToPptx(htmlFilePath, outputPptxPath, { isDebug })
        .then(result => {
            console.log(`PPTX 文件生成成功: ${result.outputPath}, 幻灯片数量: ${result.slideCount}`);
            if (result.statistics) {
                console.log(`统计: 成功 ${result.statistics.success}/${result.statistics.total}, 失败 ${result.statistics.failed}`);
                if (result.statistics.failed > 0) {
                    console.log(`失败的幻灯片: ${result.statistics.failedSlides.map(s => `第${s.index}页`).join(', ')}`);
                }
            }
            process.exit(0);
        })
        .catch(error => {
            console.error(`生成 PPTX 文件失败: ${error.message}`);
            process.exit(1);
        });
}
