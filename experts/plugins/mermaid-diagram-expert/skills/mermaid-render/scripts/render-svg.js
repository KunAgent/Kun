#!/usr/bin/env node
/**
 * Mermaid SVG 渲染脚本
 * 
 * 用法: node render-svg.js <输入文件> <输出文件> [主题名] [选项JSON]
 * 
 * 参数:
 *   输入文件  - Mermaid 源代码文件路径 (.mmd/.txt)
 *   输出文件  - SVG 输出路径
 *   主题名    - 可选，内置主题名（默认 zinc-light）或 "custom"
 *   选项JSON  - 可选，JSON 格式的渲染选项
 * 
 * 示例:
 *   node render-svg.js flow.mmd flow.svg
 *   node render-svg.js flow.mmd flow.svg tokyo-night
 *   node render-svg.js flow.mmd flow.svg custom '{"bg":"#1a1a2e","fg":"#eaeaea"}'
 */

const fs = require('fs')
const path = require('path')

// 加载渲染引擎
let renderMermaidSVG, THEMES, DEFAULTS
try {
  const lib = require('beautiful-mermaid')
  renderMermaidSVG = lib.renderMermaidSVG
  THEMES = lib.THEMES
  DEFAULTS = lib.DEFAULTS
} catch (e) {
  console.error('❌ 渲染引擎未安装。请先执行: bash scripts/setup.sh')
  process.exit(1)
}

// 解析命令行参数
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('用法: node render-svg.js <输入文件> <输出文件> [主题名] [选项JSON]')
  console.error('')
  console.error('主题列表: ' + Object.keys(THEMES).join(', '))
  process.exit(1)
}

const inputFile = args[0]
const outputFile = args[1]
const themeName = args[2] || 'zinc-light'
const optionsJson = args[3] || '{}'

// 读取源文件
let source
try {
  source = fs.readFileSync(inputFile, 'utf-8').trim()
} catch (e) {
  console.error(`❌ 无法读取文件: ${inputFile}`)
  process.exit(1)
}

if (!source) {
  console.error('❌ 输入文件为空')
  process.exit(1)
}

// 解析渲染选项
let customOptions = {}
try {
  customOptions = JSON.parse(optionsJson)
} catch (e) {
  console.error(`❌ 选项 JSON 格式错误: ${optionsJson}`)
  process.exit(1)
}

// 构建最终渲染选项
let renderOptions = {}

if (themeName === 'custom') {
  // 自定义配色模式
  renderOptions = {
    bg: customOptions.bg || DEFAULTS.bg,
    fg: customOptions.fg || DEFAULTS.fg,
    ...customOptions,
  }
} else if (THEMES[themeName]) {
  // 使用内置主题
  renderOptions = { ...THEMES[themeName], ...customOptions }
} else {
  console.error(`❌ 未知主题: ${themeName}`)
  console.error('可用主题: ' + Object.keys(THEMES).join(', '))
  process.exit(1)
}

// 执行渲染
try {
  const svg = renderMermaidSVG(source, renderOptions)
  
  // 确保输出目录存在
  const outputDir = path.dirname(outputFile)
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  
  fs.writeFileSync(outputFile, svg, 'utf-8')
  
  const stats = fs.statSync(outputFile)
  const sizeKB = (stats.size / 1024).toFixed(1)
  
  console.log(`✅ 渲染成功`)
  console.log(`   输出: ${outputFile}`)
  console.log(`   主题: ${themeName}`)
  console.log(`   大小: ${sizeKB} KB`)
} catch (e) {
  console.error(`❌ 渲染失败: ${e.message}`)
  process.exit(1)
}
