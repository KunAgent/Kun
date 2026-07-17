#!/usr/bin/env node

/**
 * TOML Parser Unit Tests
 * 
 * 测试 TOML 解析器的各项功能
 */

import {TOMLParser} from './toml-parser.js';

// 测试工具函数
let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}\n  Expected: ${expectedStr}\n  Actual:   ${actualStr}`);
  }
}

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    failedTests.push({name, error: error.message});
    console.log(`✗ ${name}`);
    console.log(`  ${error.message}`);
  }
}

console.log('=== TOML Parser Unit Tests ===\n');

// ==================== 基本数据类型解析 ====================
console.log('--- 基本数据类型解析 ---');

test('解析布尔值 true', () => {
  const result = TOMLParser.parse('value = true');
  assertEquals(result, {value: true}, 'Should parse true');
});

test('解析布尔值 false', () => {
  const result = TOMLParser.parse('value = false');
  assertEquals(result, {value: false}, 'Should parse false');
});

test('解析整数', () => {
  const result = TOMLParser.parse('num = 42');
  assertEquals(result, {num: 42}, 'Should parse integer');
});

test('解析负整数', () => {
  const result = TOMLParser.parse('num = -123');
  assertEquals(result, {num: -123}, 'Should parse negative integer');
});

test('解析浮点数', () => {
  const result = TOMLParser.parse('num = 3.14');
  assertEquals(result, {num: 3.14}, 'Should parse float');
});

test('解析双引号字符串', () => {
  const result = TOMLParser.parse('str = "hello"');
  assertEquals(result, {str: 'hello'}, 'Should parse double-quoted string');
});

test('解析单引号字符串', () => {
  const result = TOMLParser.parse("str = 'world'");
  assertEquals(result, {str: 'world'}, 'Should parse single-quoted string');
});

test('解析包含转义字符的字符串', () => {
  const result = TOMLParser.parse('str = "line1\\nline2\\ttab"');
  assertEquals(result, {str: 'line1\nline2\ttab'}, 'Should parse escaped characters');
});

test('解析空字符串', () => {
  const result = TOMLParser.parse('str = ""');
  assertEquals(result, {str: ''}, 'Should parse empty string');
});

// ==================== 数组解析 ====================
console.log('\n--- 数组解析 ---');

test('解析空数组', () => {
  const result = TOMLParser.parse('arr = []');
  assertEquals(result, {arr: []}, 'Should parse empty array');
});

test('解析整数数组', () => {
  const result = TOMLParser.parse('arr = [1, 2, 3]');
  assertEquals(result, {arr: [1, 2, 3]}, 'Should parse integer array');
});

test('解析字符串数组', () => {
  const result = TOMLParser.parse('arr = ["a", "b", "c"]');
  assertEquals(result, {arr: ['a', 'b', 'c']}, 'Should parse string array');
});

test('解析混合类型数组', () => {
  const result = TOMLParser.parse('arr = [1, "two", true]');
  assertEquals(result, {arr: [1, 'two', true]}, 'Should parse mixed array');
});

test('解析嵌套数组', () => {
  const result = TOMLParser.parse('arr = [[1, 2], [3, 4]]');
  assertEquals(result, {arr: [[1, 2], [3, 4]]}, 'Should parse nested array');
});

// ==================== 内联表解析 ====================
console.log('\n--- 内联表解析 ---');

test('解析空内联表', () => {
  const result = TOMLParser.parse('obj = {}');
  assertEquals(result, {obj: {}}, 'Should parse empty inline table');
});

test('解析简单内联表', () => {
  const result = TOMLParser.parse('obj = {name = "test", value = 42}');
  assertEquals(result, {obj: {name: 'test', value: 42}}, 'Should parse inline table');
});

test('解析嵌套内联表', () => {
  const result = TOMLParser.parse('obj = {outer = {inner = "value"}}');
  assertEquals(result, {obj: {outer: {inner: 'value'}}}, 'Should parse nested inline table');
});

// ==================== 表和表数组 ====================
console.log('\n--- 表和表数组 ---');

test('解析简单表', () => {
  const toml = `[section]
name = "test"
value = 123`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {section: {name: 'test', value: 123}}, 'Should parse simple table');
});

test('解析嵌套表', () => {
  const toml = `[outer.inner]
key = "value"`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {outer: {inner: {key: 'value'}}}, 'Should parse nested table');
});

test('解析表数组', () => {
  const toml = `[[items]]
name = "first"

[[items]]
name = "second"`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {
    items: [
      {name: 'first'},
      {name: 'second'}
    ]
  }, 'Should parse array of tables');
});

test('解析复杂表数组', () => {
  const toml = `[[app]]
name = "frontend"
port = 3000

[[app]]
name = "backend"
port = 8080`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {
    app: [
      {name: 'frontend', port: 3000},
      {name: 'backend', port: 8080}
    ]
  }, 'Should parse complex array of tables');
});

// ==================== 多行字符串 ====================
console.log('\n--- 多行字符串 ---');

test('解析三单引号多行字符串', () => {
  const toml = `str = '''
line1
line2
'''`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {str: 'line1\nline2'}, 'Should parse triple-single-quoted multiline string');
});

test('解析三双引号多行字符串', () => {
  const toml = `str = """
line1
line2
"""`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {str: 'line1\nline2'}, 'Should parse triple-double-quoted multiline string');
});

test('解析单行多行字符串', () => {
  const toml = `str = '''single line'''`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {str: 'single line'}, 'Should parse single-line multiline string');
});

test('解析包含引号的多行字符串', () => {
  const toml = `str = '''
echo "Hello World"
'''`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {str: 'echo "Hello World"'}, 'Should preserve quotes in literal string');
});

test('解析包含转义的多行字符串', () => {
  const toml = `str = """
line1\\nline2
"""`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {str: 'line1\nline2'}, 'Should parse escapes in multiline string');
});

// ==================== 注释和空行 ====================
console.log('\n--- 注释和空行 ---');

test('忽略注释', () => {
  const toml = `# This is a comment
value = 42
# Another comment`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {value: 42}, 'Should ignore comments');
});

test('忽略空行', () => {
  const toml = `value1 = 1

value2 = 2`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {value1: 1, value2: 2}, 'Should ignore empty lines');
});

// ==================== 序列化测试 ====================
console.log('\n--- 序列化 ---');

test('序列化基本类型', () => {
  const obj = {
    bool: true,
    num: 42,
    str: 'hello'
  };
  const result = TOMLParser.stringify(obj);
  assert(result.includes('bool = true'), 'Should stringify boolean');
  assert(result.includes('num = 42'), 'Should stringify number');
  assert(result.includes('str = "hello"'), 'Should stringify string');
});

test('序列化数组', () => {
  const obj = {arr: [1, 2, 3]};
  const result = TOMLParser.stringify(obj);
  assert(result.includes('arr = [1, 2, 3]'), 'Should stringify array');
});

test('序列化表数组', () => {
  const obj = {
    app: [
      {name: 'test', port: 3000}
    ]
  };
  const result = TOMLParser.stringify(obj);
  assert(result.includes('[[app]]'), 'Should stringify array of tables header');
  assert(result.includes('name = "test"'), 'Should stringify table field');
  assert(result.includes('port = 3000'), 'Should stringify table field');
});

test('序列化单行字符串', () => {
  const obj = {str: 'hello world'};
  const result = TOMLParser.stringify(obj);
  assert(result.includes('str = "hello world"'), 'Should stringify single-line string');
});

test('序列化多行字符串（无特殊字符）', () => {
  const obj = {str: 'line1\nline2'};
  const result = TOMLParser.stringify(obj);
  assert(result.includes("'''"), 'Should use triple single quotes for simple multiline');
  assert(result.includes('line1\nline2'), 'Should preserve newlines');
});

test('序列化多行字符串（包含引号）', () => {
  const obj = {str: 'echo "hello"\nline2'};
  const result = TOMLParser.stringify(obj);
  assert(result.includes('"""'), 'Should use triple double quotes for strings with quotes');
  assert(result.includes('echo \\"hello\\"'), 'Should escape quotes');
});

test('序列化转义特殊字符', () => {
  const obj = {str: 'line with "quotes" and \\backslash'};
  const result = TOMLParser.stringify(obj);
  assert(result.includes('\\"'), 'Should escape quotes');
  assert(result.includes('\\\\'), 'Should escape backslashes');
});

// ==================== 往返测试 ====================
console.log('\n--- 往返测试（解析 → 序列化 → 解析） ---');

test('往返测试：基本类型', () => {
  const original = {
    bool: true,
    num: 42,
    str: 'test'
  };
  const serialized = TOMLParser.stringify(original);
  const parsed = TOMLParser.parse(serialized);
  assertEquals(parsed, original, 'Should round-trip basic types');
});

test('往返测试：数组', () => {
  const original = {arr: [1, 'two', true]};
  const serialized = TOMLParser.stringify(original);
  const parsed = TOMLParser.parse(serialized);
  assertEquals(parsed, original, 'Should round-trip arrays');
});

test('往返测试：表数组', () => {
  const original = {
    app: [
      {name: 'test1', port: 3000},
      {name: 'test2', port: 8080}
    ]
  };
  const serialized = TOMLParser.stringify(original);
  const parsed = TOMLParser.parse(serialized);
  assertEquals(parsed, original, 'Should round-trip array of tables');
});

test('往返测试：多行字符串', () => {
  const original = {
    str: 'line1\nline2\nline3'
  };
  const serialized = TOMLParser.stringify(original);
  const parsed = TOMLParser.parse(serialized);
  assertEquals(parsed, original, 'Should round-trip multiline strings');
});

test('往返测试：复杂结构', () => {
  const original = {
    app: [
      {
        name: 'frontend',
        cmd: 'npm run dev',
        port: 3000,
        autoRun: true
      },
      {
        name: 'backend',
        cmd: 'cd backend\nnpm start',
        port: 8080,
        autoRun: false
      }
    ]
  };
  const serialized = TOMLParser.stringify(original);
  const parsed = TOMLParser.parse(serialized);
  assertEquals(parsed, original, 'Should round-trip complex structure');
});

// ==================== .cloudstudio 实际场景 ====================
console.log('\n--- .cloudstudio 实际场景 ---');

test('.cloudstudio 场景：简单应用配置', () => {
  const toml = `[[app]]
name = "myapp"
cmd = "npm run dev"
port = 3000
autoRun = true`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {
    app: [{
      name: 'myapp',
      cmd: 'npm run dev',
      port: 3000,
      autoRun: true
    }]
  }, 'Should parse simple app config');
});

test('.cloudstudio 场景：多应用配置', () => {
  const toml = `[[app]]
name = "frontend"
cmd = "npm run dev"
port = 3000
autoRun = true

[[app]]
name = "backend"
cmd = "npm start"
port = 8080
autoRun = true`;
  const result = TOMLParser.parse(toml);
  assertEquals(result, {
    app: [
      {name: 'frontend', cmd: 'npm run dev', port: 3000, autoRun: true},
      {name: 'backend', cmd: 'npm start', port: 8080, autoRun: true}
    ]
  }, 'Should parse multiple apps');
});

test('.cloudstudio 场景：bash -c 命令', () => {
  const toml = `[[app]]
name = "app"
cmd = "bash -c \\"cd /path && npm start\\""
port = 3000`;
  const result = TOMLParser.parse(toml);
  assert(result.app[0].cmd === 'bash -c "cd /path && npm start"', 'Should parse bash -c command');
});

test('.cloudstudio 场景：多行命令', () => {
  const toml = `[[app]]
name = "app"
cmd = '''
cd /path/to/dir
npm install
npm start
'''
port = 3000`;
  const result = TOMLParser.parse(toml);
  assert(result.app[0].cmd === 'cd /path/to/dir\nnpm install\nnpm start', 'Should parse multiline command');
});

// ==================== 边界情况 ====================
console.log('\n--- 边界情况 ---');

test('空 TOML 文档', () => {
  const result = TOMLParser.parse('');
  assertEquals(result, {}, 'Should parse empty document');
});

test('只有注释的文档', () => {
  const result = TOMLParser.parse('# comment only');
  assertEquals(result, {}, 'Should parse comment-only document');
});

test('键值对周围有空格', () => {
  const result = TOMLParser.parse('  key  =  "value"  ');
  assertEquals(result, {key: 'value'}, 'Should handle whitespace around key-value');
});

test('数组中有空格', () => {
  const result = TOMLParser.parse('arr = [ 1 , 2 , 3 ]');
  assertEquals(result, {arr: [1, 2, 3]}, 'Should handle whitespace in arrays');
});

test('序列化 null 和 undefined', () => {
  const obj = {null: null, undef: undefined};
  const result = TOMLParser.stringify(obj);
  assert(result.includes('null = ""'), 'Should stringify null as empty string');
  assert(result.includes('undef = ""'), 'Should stringify undefined as empty string');
});

// ==================== 测试结果汇总 ====================
console.log('\n' + '='.repeat(60));
console.log('测试结果汇总:');
console.log(`  通过: ${testsPassed}`);
console.log(`  失败: ${testsFailed}`);
console.log(`  总计: ${testsPassed + testsFailed}`);

if (testsFailed > 0) {
  console.log('\n失败的测试:');
  failedTests.forEach(({name, error}) => {
    console.log(`  - ${name}`);
    console.log(`    ${error}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ 所有测试通过！');
  process.exit(0);
}
