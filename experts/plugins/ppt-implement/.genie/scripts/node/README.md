# Node.js Scripts

本目录包含 CloudStudio 工作空间相关的 Node.js 脚本。

## 文件说明

### process
进程管理器，用于启动、停止和管理工作空间中的应用进程。

**功能特性：**
- 进程生命周期管理（启动、停止、重启）
- 日志管理
- 进程列表查看
- 多环境支持（使用策略模式）
- 自动生成 `.cloudstudio` 配置文件（本地模式）
- 自动发送配置到 CloudStudio API（cloudstudio 模式）
- 支持工作目录 (`--cwd`) 和端口 (`--port`) 配置

**运行模式（策略模式）：**

process 使用策略模式支持多种运行环境，自动根据环境检测并应用相应策略：

1. **本地模式 (Local Mode)**
   - 策略类：`LocalStrategy`
   - 检测条件：默认策略（总是可用）
   - 行为：启动进程后，将配置写入项目根目录的 `.cloudstudio` 文件
   - 适用场景：本地开发环境

2. **CloudStudio 模式 (CloudStudio Mode)**
   - 策略类：`CloudStudioStrategy`
   - 检测条件：`/run/cloudstudio/space.yaml` 文件存在
   - 行为：启动进程后，将配置通过 HTTP POST 请求发送到 `http://127.0.0.1:6531/replaceCloudStudioConfig`
   - 请求格式：
     ```json
     {
       "app": [
         {
           "name": "app-name",
           "cmd": "command to execute",
           "port": 3000
         }
       ],
       "restart": true
     }
     ```
   - 适用场景：CloudStudio 在线工作空间

**扩展新环境：**

通过策略模式，可以轻松添加新的运行环境支持：

```javascript
class NewEnvironmentStrategy extends ConfigStrategy {
  getName() {
    return 'new-environment';
  }

  isApplicable() {
    // 检测是否在新环境中
    return existsSync('/path/to/environment/marker');
  }

  async updateConfig(params) {
    // 实现配置更新逻辑
  }
}

// 注册新策略
strategyManager.registerStrategy(new NewEnvironmentStrategy());
```

**使用示例：**
```bash
# 启动进程
./process start myapp -- npm run dev

# 启动进程并指定工作目录和端口
./process start frontend --cwd frontend --port 3000 -- npm run dev

# 重启进程
./process start frontend --restart --cwd frontend --port 8080 -- npm run dev

# 查看运行中的进程
./process list

# 查看进程日志
./process logs myapp --lines 100

# 停止进程
./process stop myapp

# 停止服务器
./process stop-server
./process stop-server --force
```

### toml-parser.js
TOML 格式解析器和序列化器，用于处理 `.cloudstudio` 配置文件。

**功能特性：**
- 解析 TOML 格式文本为 JavaScript 对象
- 将 JavaScript 对象序列化为 TOML 格式
- 支持基本数据类型（布尔值、整数、浮点数、字符串）
- 支持数组和内联表
- 支持表 `[table]` 和表数组 `[[array]]`
- 支持多行字符串（`'''...'''` 和 `"""..."""`）
- 支持注释和空行

**使用示例：**
```javascript
import {TOMLParser} from './toml-parser.js';

// 解析 TOML 字符串
const toml = `
[[app]]
name = "frontend"
cmd = "npm run dev"
port = 3000
`;

const config = TOMLParser.parse(toml);
console.log(config);
// { app: [{ name: 'frontend', cmd: 'npm run dev', port: 3000 }] }

// 序列化为 TOML
const obj = {
  app: [
    { name: 'backend', cmd: 'npm start', port: 8080 }
  ]
};

const tomlString = TOMLParser.stringify(obj);
console.log(tomlString);
```

### toml-parser.test.js
TOML 解析器的单元测试文件。

**运行测试：**
```bash
node context/scripts/node/toml-parser.test.js
```

**测试覆盖范围：**
- ✓ 基本数据类型解析（9 个测试）
- ✓ 数组解析（5 个测试）
- ✓ 内联表解析（3 个测试）
- ✓ 表和表数组（4 个测试）
- ✓ 多行字符串（5 个测试）
- ✓ 注释和空行（2 个测试）
- ✓ 序列化功能（7 个测试）
- ✓ 往返测试（5 个测试）
- ✓ .cloudstudio 实际场景（4 个测试）
- ✓ 边界情况（5 个测试）

**总计：49 个测试**

## .cloudstudio 文件格式

`.cloudstudio` 文件使用 TOML 格式配置工作空间应用。

### 基本示例

```toml
[[app]]
name = "frontend"
cmd = "npm run dev"
port = 3000
autoRun = true

[[app]]
name = "backend"
cmd = "npm start"
port = 8080
autoRun = true
```

### 多行命令示例

```toml
[[app]]
name = "setup"
cmd = '''
cd /path/to/project
npm install
npm run build
npm start
'''
port = 3000
autoRun = true
```

### 字段说明

- `name` (字符串): 应用名称
- `cmd` (字符串): 执行命令
- `port` (整数): 服务端口，范围 [1, 60000)
- `autoRun` (布尔): 是否自动启动

## 开发说明

### 项目结构
```
context/scripts/node/
├── process              # 进程管理器主程序
├── toml-parser.js       # TOML 解析器模块
├── toml-parser.test.js  # 单元测试
└── README.md            # 本文档
```

### 运行模式架构（策略模式）

```
┌─────────────────────────────────────────────────┐
│          process 脚本启动                       │
└─────────────────────────────────────────────────┘
                      │
                      ▼
              StrategyManager.getCurrentStrategy()
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
  CloudStudioStrategy          LocalStrategy
  (优先级高)                   (默认策略)
        │                           │
        ▼                           ▼
  检测 /run/cloudstudio/space.yaml  总是返回 true
        │                           │
   ┌────┴────┐                      │
   ▼         ▼                      ▼
 存在      不存在               应用策略
   │         │                      │
   ▼         │                      ▼
应用策略     └──────────────────►  执行相应的
   │                              updateConfig()
   ▼                                   │
发送 HTTP POST                          ▼
到 127.0.0.1:6531                  写入 .cloudstudio
   │                                   │
   └─────────────┬─────────────────────┘
                 ▼
               完成
```

**策略选择逻辑：**
1. 按注册顺序检查每个策略的 `isApplicable()`
2. 使用第一个返回 `true` 的策略
3. `LocalStrategy` 作为默认策略总是在最后，保证至少有一个策略可用

**添加新策略：**
```javascript
// 1. 创建新策略类
class CustomStrategy extends ConfigStrategy {
  getName() { return 'custom'; }
  isApplicable() { return checkCustomEnvironment(); }
  async updateConfig(params) { /* 实现逻辑 */ }
}

// 2. 注册策略（自动插入到 LocalStrategy 之前）
strategyManager.registerStrategy(new CustomStrategy());
```

### 代码风格
- 使用 ES6+ 模块（`import`/`export`）
- 遵循 JSDoc 文档规范
- 每个函数都有详细的注释说明

### 测试
在修改代码后，请务必运行单元测试确保功能正常：

```bash
node context/scripts/node/toml-parser.test.js
```

所有测试应该通过（49/49）。

## 依赖

本项目仅使用 Node.js 内置模块，无需安装额外依赖：
- `fs` - 文件系统操作
- `path` - 路径处理
- `http` - HTTP 服务器和客户端
- `child_process` - 子进程管理
- `crypto` - 哈希计算

## 许可

与 CloudStudio 项目保持一致。
