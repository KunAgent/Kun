#!/usr/bin/env node
/**
 * 构建脚本：将每个 slide-X.js 生成为独立的 slide-X.html 文件
 * 结构参考 slide_0.html：
 * - 简洁的 HTML 结构
 * - 每页只有一个 slide-page class
 * - Tailwind CSS 转为内联样式
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import juice from 'juice';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 输出目录
const outputDir = path.join(rootDir, 'dist-slides');

// 从 index.html 提取完整的 <head> 内容
function extractHeadFromIndex() {
  const indexPath = path.join(rootDir, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf-8');
  
  // 提取完整的 <head> 内容（不含 <head> 和 </head> 标签本身）
  const headMatch = indexContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  let headContent = '';
  if (headMatch) {
    headContent = headMatch[1]
      // 移除 script 标签（不需要在静态 HTML 中）
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // 移除 Vite 相关的注释
      .replace(/<!--[\s\S]*?-->/g, '')
      // 清理多余空行
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }
  
  return {
    headContent
  };
}

// 读取样式文件
function readStyles() {
  const mainCss = fs.readFileSync(path.join(rootDir, 'src/styles/main.css'), 'utf-8');
  return { mainCss };
}

// 从 slide-X.js 文件中提取 HTML 内容
function extractSlideContent(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  // 匹配 window.slideDataMap.set(N, `...`) 中的内容
  const match = content.match(/window\.slideDataMap\.set\(\d+,\s*`([\s\S]*?)`\s*\);/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

// 获取所有 slide 文件
function getSlideFiles() {
  const slidesDir = path.join(rootDir, 'src/slides');
  const files = fs.readdirSync(slidesDir);
  return files
    .filter(f => /^slide-\d+\.js$/.test(f))
    .map(f => ({
      name: f,
      number: parseInt(f.match(/slide-(\d+)\.js/)[1]),
      path: path.join(slidesDir, f)
    }))
    .sort((a, b) => a.number - b.number);
}

// 生成 Tailwind CSS
function generateTailwindCss(slideContents) {
  // 创建临时目录
  const tempDir = path.join(rootDir, '.temp-build');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 创建临时 HTML 文件，包含所有 slide 内容
  const tempHtml = `<!DOCTYPE html>
<html>
<body>
${slideContents.map(s => s.content).join('\n')}
</body>
</html>`;
  
  const tempHtmlPath = path.join(tempDir, 'temp-slides.html');
  fs.writeFileSync(tempHtmlPath, tempHtml);

  // 读取原始样式
  const { mainCss } = readStyles();
  
  // 创建临时 CSS 输入文件
  const tempCssInput = path.join(tempDir, 'input.css');
  fs.writeFileSync(tempCssInput, mainCss);

  // 创建临时 tailwind 配置
  const tempTailwindConfig = path.join(tempDir, 'tailwind.config.js');
  fs.writeFileSync(tempTailwindConfig, `
export default {
  content: ['${tempHtmlPath}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
`);

  // 运行 Tailwind CLI
  const tempCssOutput = path.join(tempDir, 'output.css');
  try {
    execSync(`npx tailwindcss -i "${tempCssInput}" -o "${tempCssOutput}" -c "${tempTailwindConfig}"`, {
      cwd: rootDir,
      stdio: 'pipe'
    });
  } catch (error) {
    console.error('Tailwind CSS 处理失败:', error.message);
    fs.writeFileSync(tempCssOutput, mainCss);
  }

  // 读取生成的 CSS
  const outputCss = fs.readFileSync(tempCssOutput, 'utf-8');

  // 清理临时文件
  fs.rmSync(tempDir, { recursive: true, force: true });

  return outputCss;
}

// 生成带样式的临时 HTML 用于 juice 处理
function generateTempHtmlForJuice(slideContent, tailwindCss) {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
${tailwindCss}
  </style>
</head>
<body>
${slideContent}
</body>
</html>`;
}

// 使用 juice 将 CSS 转为内联样式
function inlineStyles(html) {
  const result = juice(html, {
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
    preserveKeyFrames: false,
    applyStyleTags: true,
    insertPreservedExtraCss: false,
    extraCss: ''
  });
  return result;
}

// 从内联后的 HTML 中提取 body 内容
function extractBodyContent(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1].trim();
  }
  return html;
}

// 清理内联样式中的冗余属性
function cleanInlineStyles(content) {
  // 移除 class 属性（样式已内联）
  let cleaned = content.replace(/\s*class="[^"]*"/g, '');
  
  // 移除 Tailwind reset 的冗余样式
  cleaned = cleaned.replace(/style="([^"]*)"/g, (match, styleContent) => {
    let cleanedStyle = styleContent
      // 移除 Tailwind 的 border reset
      .replace(/border-width:\s*0;\s*/g, '')
      .replace(/border-style:\s*solid;\s*/g, '')
      .replace(/border-color:\s*#e5e7eb;\s*/g, '')
      .replace(/border-:\s*/g, '') // 处理被截断的情况
      // 移除 Tailwind 的 box-sizing reset（如果没有其他特殊需求）
      .replace(/box-sizing:\s*border-box;\s*/g, '')
      // 移除冗余的 margin: 0 和 padding: 0（如果是默认值）
      .replace(/margin:\s*0;\s*/g, '')
      .replace(/padding:\s*0;\s*/g, '')
      // 清理开头和结尾的空格和分号
      .replace(/^[\s;]+/, '')
      .replace(/[\s;]+$/, '')
      .trim();
    
    if (!cleanedStyle) {
      return '';
    }
    return `style="${cleanedStyle}"`;
  });
  
  // 移除空的 style 属性
  cleaned = cleaned.replace(/\s*style=""/g, '');
  
  // 清理多余空格
  cleaned = cleaned.replace(/\s+>/g, '>');
  
  return cleaned;
}

// 转换原始 slide 内容中的图片路径为绝对路径
function transformSlideContent(content) {
  let transformed = content;
  
  // assets 目录的绝对路径
  const assetsAbsPath = path.join(rootDir, 'public', 'assets');
  
  // 将图片路径从 /assets/ 改为绝对路径
  transformed = transformed.replace(/src="\/assets\//g, `src="${assetsAbsPath}/`);
  // 将图片路径从 assets/ 改为绝对路径
  transformed = transformed.replace(/src="assets\//g, `src="${assetsAbsPath}/`);
  
  return transformed;
}

// 为最外层 div 添加 slide-page class
function wrapWithSlidePage(bodyContent) {
  // 找到第一个 div 并添加 class="slide-page"，保留原有样式
  // 注意：内容开头可能有 HTML 注释，需要跳过注释找到第一个 div
  
  // 使用正则替换第一个 <div 标签，添加 slide-page class
  // 匹配第一个 <div，前面可能有注释或空白
  bodyContent = bodyContent.replace(
    /(<div)([\s>])/,
    '$1 class="slide-page"$2'
  );
  
  return bodyContent;
}

// 生成最终的独立 HTML 文件（使用 index.html 的 head 内容）
function generateFinalHtml(bodyContent, headInfo) {
  return `<!DOCTYPE html>
<html>
<head>
${headInfo.headContent}
</head>
<body>
${bodyContent}
</body>
</html>`;
}

// 主函数
async function main() {
  console.log('🚀 开始构建独立 slide HTML 文件...\n');

  // 创建输出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 从 index.html 提取字体和 CSS 变量
  console.log('📄 从 index.html 提取字体和 CSS 变量...');
  const headInfo = extractHeadFromIndex();

  // 获取所有 slide 文件
  const slideFiles = getSlideFiles();
  console.log(`📄 找到 ${slideFiles.length} 个 slide 文件\n`);

  // 提取所有 slide 内容
  const slideContents = [];
  for (const slide of slideFiles) {
    const content = extractSlideContent(slide.path);
    if (content) {
      // 转换图片路径
      const transformedContent = transformSlideContent(content);
      slideContents.push({
        number: slide.number,
        content: transformedContent,
        name: slide.name
      });
    } else {
      console.warn(`⚠️  无法提取 ${slide.name} 的内容`);
    }
  }

  // 生成 Tailwind CSS
  console.log('🎨 处理 Tailwind CSS...');
  const tailwindCss = generateTailwindCss(slideContents);

  // 复制 assets 目录
  const assetsSourceDir = path.join(rootDir, 'public/assets');
  const assetsDestDir = path.join(outputDir, 'assets');
  if (fs.existsSync(assetsSourceDir)) {
    console.log('📁 复制 assets 目录...');
    fs.cpSync(assetsSourceDir, assetsDestDir, { recursive: true });
  }

  // 生成每个 slide 的 HTML 文件
  console.log('🔄 转换为内联样式...\n');
  
  for (const slide of slideContents) {
    // 生成带样式的临时 HTML
    const tempHtml = generateTempHtmlForJuice(slide.content, tailwindCss);
    
    // 使用 juice 转换为内联样式
    const inlinedHtml = inlineStyles(tempHtml);
    
    // 提取 body 内容
    let bodyContent = extractBodyContent(inlinedHtml);
    
    // 清理内联样式
    bodyContent = cleanInlineStyles(bodyContent);
    
    // 包装为 slide-page
    bodyContent = wrapWithSlidePage(bodyContent);
    
    // 生成最终 HTML（传入 headInfo）
    const finalHtml = generateFinalHtml(bodyContent, headInfo);
    
    // 保存到文件（下标从 0 开始）
    const outputIndex = slide.number - 1;
    const outputPath = path.join(outputDir, `slide-${outputIndex}.html`);
    fs.writeFileSync(outputPath, finalHtml);
    console.log(`   ✅ slide-${outputIndex}.html`);
  }

  // 从已生成的 slide-x.html 文件中提取 body 内容，合并到 all-slides.html
  console.log('\n📦 生成合并文件...');
  const allBodyContents = [];
  for (let i = 0; i < slideContents.length; i++) {
    const slideHtmlPath = path.join(outputDir, `slide-${i}.html`);
    if (!fs.existsSync(slideHtmlPath)) {
      console.warn(`⚠️  无法找到 ${slideHtmlPath}`);
      continue;
    }
    const slideHtml = fs.readFileSync(slideHtmlPath, 'utf-8');
    const bodyContent = extractBodyContent(slideHtml);
    allBodyContents.push(bodyContent);
  }
  
  const mergedHtml = generateMergedHtml(allBodyContents, headInfo);
  const mergedPath = path.join(outputDir, 'all-slides.html');
  fs.writeFileSync(mergedPath, mergedHtml);
  console.log(`   ✅ all-slides.html`);

  console.log(`\n🎉 构建完成！输出目录: ${outputDir}`);
  console.log(`   共生成 ${slideContents.length} 个独立 HTML 文件 + 1 个合并文件`);
}

// 生成合并后的 HTML 文件（使用 index.html 的 head 内容）
function generateMergedHtml(bodyContents, headInfo) {
  return `<!DOCTYPE html>
<html>
<head>
${headInfo.headContent}
</head>
<body>

${bodyContents.join('\n\n')}

</body>
</html>`;
}

main().catch(console.error);
