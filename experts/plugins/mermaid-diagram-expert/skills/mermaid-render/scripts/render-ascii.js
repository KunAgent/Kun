#!/usr/bin/env node
/**
 * Mermaid ASCII/Unicode 渲染脚本
 * 
 * 用法: node render-ascii.js <输入文件> [选项JSON]
 * 
 * 参数:
 *   输入文件  - Mermaid 源代码文件路径 (.mmd/.txt)
 *   选项JSON  - 可选，JSON 格式的渲染选项
 * 
 * 选项:
 *   useAscii        - true 使用纯 ASCII, false 使用 Unicode (默认 false)
 *   paddingX        - 水平节点间距 (默认 5)
 *   paddingY        - 垂直节点间距 (默认 5)
 *   boxBorderPadding - 节点内边距 (默认 1)
 *   colorMode       - 着色模式: none/auto/ansi16/ansi256/truecolor/html (默认 auto)
 * 
 * 示例:
 *   node render-ascii.js flow.mmd
 *   node render-ascii.js flow.mmd '{"useAscii":true}'
 *   node render-ascii.js flow.mmd '{"colorMode":"truecolor"}'
 */

const fs = require('fs')

// 加载渲染引擎
let renderMermaidASCII
try {
  const lib = require('beautiful-mermaid')
  renderMermaidASCII = lib.renderMermaidASCII
} catch (e) {
  console.error('❌ 渲染引擎未安装。请先执行: bash scripts/setup.sh')
  process.exit(1)
}

// 解析命令行参数
const args = process.argv.slice(2)

if (args.length < 1) {
  console.error('用法: node render-ascii.js <输入文件> [选项JSON]')
  console.error('')
  console.error('选项:')
  console.error('  useAscii: true/false (默认 false，使用 Unicode)')
  console.error('  paddingX: 水平间距 (默认 5)')
  console.error('  paddingY: 垂直间距 (默认 5)')
  console.error('  colorMode: none/auto/ansi16/ansi256/truecolor/html')
  process.exit(1)
}

const inputFile = args[0]
const optionsJson = args[1] || '{}'

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

// 解析选项
let options = {}
try {
  options = JSON.parse(optionsJson)
} catch (e) {
  console.error(`❌ 选项 JSON 格式错误: ${optionsJson}`)
  process.exit(1)
}

// 执行 ASCII 渲染
try {
  const ascii = renderMermaidASCII(source, options)
  console.log(ascii)
} catch (e) {
  console.error(`❌ ASCII 渲染失败: ${e.message}`)
  process.exit(1)
}
