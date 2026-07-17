/**
 * TOML Parser/Serializer
 * 
 * 简单但完善的 TOML 解析器，专门用于 .cloudstudio 文件格式
 * 支持基本数据类型、内联表和表数组
 * 
 * @module toml-parser
 */

/**
 * TOML 解析器类
 */
export class TOMLParser {
  /**
   * 解析 TOML 字符串为 JavaScript 对象
   * @param {string} content - TOML 内容
   * @returns {Object} 解析后的对象
   */
  static parse(content) {
    const lines = content.split('\n');
    const result = {};
    let currentTable = result;
    let currentTablePath = [];
    let currentArrayTable = null;
    let currentArrayTablePath = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 跳过空行和注释
      if (!line || line.startsWith('#')) {
        continue;
      }

      // 表数组 [[table]]
      if (line.startsWith('[[') && line.endsWith(']]')) {
        const tableName = line.slice(2, -2).trim();
        currentArrayTablePath = tableName.split('.');
        
        // 创建嵌套结构
        let target = result;
        for (let j = 0; j < currentArrayTablePath.length; j++) {
          const key = currentArrayTablePath[j];
          if (j === currentArrayTablePath.length - 1) {
            // 最后一级，创建数组
            if (!target[key]) {
              target[key] = [];
            }
            currentArrayTable = {};
            target[key].push(currentArrayTable);
            currentTable = currentArrayTable;
          } else {
            // 中间层级
            if (!target[key]) {
              target[key] = {};
            }
            target = target[key];
          }
        }
        currentTablePath = [];
        continue;
      }

      // 普通表 [table]
      if (line.startsWith('[') && line.endsWith(']')) {
        const tableName = line.slice(1, -1).trim();
        currentTablePath = tableName.split('.');
        currentArrayTablePath = [];
        currentArrayTable = null;

        // 创建嵌套结构
        let target = result;
        for (const key of currentTablePath) {
          if (!target[key]) {
            target[key] = {};
          }
          target = target[key];
        }
        currentTable = target;
        continue;
      }

      // 键值对
      const equalIndex = line.indexOf('=');
      if (equalIndex > 0) {
        const key = line.slice(0, equalIndex).trim();
        let valueStr = line.slice(equalIndex + 1).trim();
        
        // 检查是否是多行字符串的开始
        if (valueStr.startsWith('"""') || valueStr.startsWith("'''")) {
          const delimiter = valueStr.slice(0, 3);
          const multiLineResult = this.parseMultiLineString(lines, i, delimiter, valueStr);
          currentTable[key] = multiLineResult.value;
          i = multiLineResult.newIndex;
        } else {
          const value = this.parseValue(valueStr);
          currentTable[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * 解析多行字符串
   * @param {string[]} lines - 所有行
   * @param {number} startIndex - 起始行索引
   * @param {string} delimiter - 分隔符 (""" 或 ''')
   * @param {string} firstLine - 第一行的内容
   * @returns {{value: string, newIndex: number}} 解析结果和新的行索引
   */
  static parseMultiLineString(lines, startIndex, delimiter, firstLine) {
    const isLiteral = delimiter === "'''"; // 单引号是字面量字符串，不转义
    let content = firstLine.slice(3); // 移除开始的 """ 或 '''
    
    // 检查是否在同一行就结束了
    if (content.endsWith(delimiter)) {
      const value = content.slice(0, -3);
      return {
        value: isLiteral ? value : this.unescapeString(value),
        newIndex: startIndex
      };
    }

    // 多行情况
    const contentLines = [content];
    let i = startIndex + 1;
    
    for (; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes(delimiter)) {
        // 找到结束标记
        const endIndex = line.indexOf(delimiter);
        const lastPart = line.slice(0, endIndex);
        contentLines.push(lastPart);
        break;
      } else {
        contentLines.push(line);
      }
    }

    // 组合所有行，保留换行符
    let result = contentLines.join('\n');
    
    // 如果第一行只有分隔符，移除开头的换行
    if (contentLines[0] === '') {
      result = result.slice(1);
    }

    // 移除尾部的换行符（如果最后一行是空的）
    if (contentLines[contentLines.length - 1] === '') {
      result = result.slice(0, -1);
    }

    return {
      value: isLiteral ? result : this.unescapeString(result),
      newIndex: i
    };
  }

  /**
   * 反转义字符串
   * @param {string} str - 需要反转义的字符串
   * @returns {string} 反转义后的字符串
   */
  static unescapeString(str) {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  /**
   * 解析 TOML 值
   * @param {string} valueStr - 值字符串
   * @returns {*} 解析后的值
   */
  static parseValue(valueStr) {
    valueStr = valueStr.trim();

    // 布尔值
    if (valueStr === 'true') return true;
    if (valueStr === 'false') return false;

    // 单行字符串（双引号或单引号）
    if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
      const isLiteral = valueStr.startsWith("'");
      const content = valueStr.slice(1, -1);
      return isLiteral ? content : this.unescapeString(content);
    }

    // 数字
    if (/^-?\d+$/.test(valueStr)) {
      return parseInt(valueStr, 10);
    }
    if (/^-?\d+\.\d+$/.test(valueStr)) {
      return parseFloat(valueStr);
    }

    // 数组
    if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      const arrayContent = valueStr.slice(1, -1).trim();
      if (!arrayContent) return [];
      
      const items = this.splitArrayItems(arrayContent);
      return items.map(item => this.parseValue(item.trim()));
    }

    // 内联表
    if (valueStr.startsWith('{') && valueStr.endsWith('}')) {
      const tableContent = valueStr.slice(1, -1).trim();
      if (!tableContent) return {};
      
      const obj = {};
      const pairs = this.splitTablePairs(tableContent);
      for (const pair of pairs) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex > 0) {
          const key = pair.slice(0, eqIndex).trim();
          const val = pair.slice(eqIndex + 1).trim();
          obj[key] = this.parseValue(val);
        }
      }
      return obj;
    }

    // 默认作为字符串
    return valueStr;
  }

  /**
   * 分割数组项（处理嵌套）
   * @param {string} content - 数组内容
   * @returns {string[]} 数组项
   */
  static splitArrayItems(content) {
    const items = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = null;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : null;

      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      }

      if (!inString) {
        if (char === '[' || char === '{') depth++;
        if (char === ']' || char === '}') depth--;
        
        if (char === ',' && depth === 0) {
          items.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) {
      items.push(current.trim());
    }

    return items;
  }

  /**
   * 分割内联表的键值对（处理嵌套）
   * @param {string} content - 表内容
   * @returns {string[]} 键值对
   */
  static splitTablePairs(content) {
    const pairs = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = null;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : null;

      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      }

      if (!inString) {
        if (char === '[' || char === '{') depth++;
        if (char === ']' || char === '}') depth--;
        
        if (char === ',' && depth === 0) {
          pairs.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) {
      pairs.push(current.trim());
    }

    return pairs;
  }

  /**
   * 将 JavaScript 对象序列化为 TOML 字符串
   * @param {Object} obj - 要序列化的对象
   * @returns {string} TOML 字符串
   */
  static stringify(obj) {
    const lines = [];

    // 先处理顶层的简单键值对
    for (const [key, value] of Object.entries(obj)) {
      if (!this.isComplexValue(value)) {
        lines.push(`${key} = ${this.stringifyValue(value)}`);
      } else if (Array.isArray(value) && !this.isTableArray(value)) {
        // 基本类型数组，使用内联格式
        lines.push(`${key} = ${this.stringifyValue(value)}`);
      }
    }

    // 再处理表和表数组
    for (const [key, value] of Object.entries(obj)) {
      if (this.isComplexValue(value) && !(Array.isArray(value) && !this.isTableArray(value))) {
        if (lines.length > 0) {
          lines.push(''); // 添加空行分隔
        }
        this.stringifyTable(lines, key, value);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * 判断数组是否为表数组（所有元素都是对象）
   * @param {Array} arr - 数组
   * @returns {boolean}
   */
  static isTableArray(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      return false;
    }
    // 只有当所有元素都是非空对象时，才认为是表数组
    return arr.every(item => 
      item !== null && 
      typeof item === 'object' && 
      !Array.isArray(item) &&
      Object.keys(item).length > 0
    );
  }

  /**
   * 判断是否为复杂值（对象或数组）
   * @param {*} value - 值
   * @returns {boolean}
   */
  static isComplexValue(value) {
    return value !== null && typeof value === 'object';
  }

  /**
   * 序列化表
   * @param {string[]} lines - 输出行数组
   * @param {string} path - 表路径
   * @param {*} value - 值
   */
  static stringifyTable(lines, path, value) {
    if (Array.isArray(value)) {
      // 表数组
      for (const item of value) {
        lines.push(`[[${path}]]`);
        for (const [k, v] of Object.entries(item)) {
          lines.push(`${k} = ${this.stringifyValue(v)}`);
        }
        lines.push(''); // 每个表数组项后添加空行
      }
    } else if (typeof value === 'object' && value !== null) {
      // 普通表
      lines.push(`[${path}]`);
      for (const [k, v] of Object.entries(value)) {
        if (!this.isComplexValue(v)) {
          lines.push(`${k} = ${this.stringifyValue(v)}`);
        }
      }

      // 处理嵌套表
      for (const [k, v] of Object.entries(value)) {
        if (this.isComplexValue(v)) {
          lines.push('');
          this.stringifyTable(lines, `${path}.${k}`, v);
        }
      }
    }
  }

  /**
   * 序列化值
   * @param {*} value - 值
   * @returns {string} TOML 值字符串
   */
  static stringifyValue(value) {
    if (value === null || value === undefined) {
      return '""';
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'string') {
      // 如果字符串包含换行符，使用多行字符串格式
      if (value.includes('\n')) {
        // 检查是否需要转义（包含反斜杠或双引号）
        const needsEscaping = /[\\"]/.test(value.replace(/\n/g, ''));
        
        if (needsEscaping) {
          // 使用三双引号字符串，需要转义
          const escaped = value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          // 去除尾部换行符，然后添加格式化的换行
          const trimmed = escaped.replace(/\n+$/, '');
          return `"""\n${trimmed}\n"""`;
        } else {
          // 使用三单引号字符串，字面量，不转义
          // 去除尾部换行符
          const trimmed = value.replace(/\n+$/, '');
          return `'''\n${trimmed}\n'''`;
        }
      } else {
        // 单行字符串，使用普通双引号
        const escaped = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t');
        return `"${escaped}"`;
      }
    }

    if (Array.isArray(value)) {
      const items = value.map(v => this.stringifyValue(v));
      return `[${items.join(', ')}]`;
    }

    if (typeof value === 'object') {
      const pairs = Object.entries(value)
        .map(([k, v]) => `${k} = ${this.stringifyValue(v)}`);
      return `{${pairs.join(', ')}}`;
    }

    return '""';
  }
}
