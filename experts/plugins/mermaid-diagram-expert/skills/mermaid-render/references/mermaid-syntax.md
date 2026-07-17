# Mermaid 语法速查手册

## 一、流程图 (Flowchart)

### 声明方式
```
graph TD        %% 自顶向下
graph LR        %% 从左到右
graph BT        %% 自底向上
graph RL        %% 从右到左
flowchart TD    %% 等价于 graph TD
```

### 节点形状

| 语法 | 形状 | 示例 |
|------|------|------|
| `A[text]` | 矩形 | `A[开始处理]` |
| `A(text)` | 圆角矩形 | `A(处理数据)` |
| `A{text}` | 菱形（判断） | `A{是否通过?}` |
| `A([text])` | 体育场形 | `A([终端])` |
| `A((text))` | 圆形 | `A((起点))` |
| `A[[text]]` | 子例程 | `A[[子流程]]` |
| `A(((text)))` | 双圆 | `A(((信号)))` |
| `A{{text}}` | 六角形 | `A{{准备}}` |
| `A[(text)]` | 圆柱（数据库） | `A[(数据库)]` |
| `A>text]` | 不对称（旗帜） | `A>事件]` |
| `A[/text\]` | 梯形 | `A[/输入\]` |
| `A[\text/]` | 倒梯形 | `A[\输出/]` |

### 边线类型

| 语法 | 类型 |
|------|------|
| `-->` | 实线箭头 |
| `---` | 实线无箭头 |
| `-.->` | 虚线箭头 |
| `-.-` | 虚线无箭头 |
| `==>` | 粗线箭头 |
| `===` | 粗线无箭头 |
| `<-->` | 双向实线箭头 |
| `<-.->` | 双向虚线箭头 |
| `<==>` | 双向粗线箭头 |

### 边标签
```
A -->|标签文本| B
A -- 标签文本 --> B    %% 等价写法
```

### 子图 (Subgraph)
```
subgraph 标题
  direction LR       %% 可选：子图内方向覆盖
  A --> B
  B --> C
end
```

子图可嵌套：
```
subgraph 外层
  subgraph 内层
    A --> B
  end
  C --> D
end
```

### 并行链接
```
A & B --> C & D
%% 等价于: A-->C, A-->D, B-->C, B-->D
```

### 链式连接
```
A --> B --> C --> D
%% 等价于: A-->B, B-->C, C-->D
```

### 类定义与样式
```
classDef highlight fill:#f9f,stroke:#333,stroke-width:2px
class A,B highlight

%% 或使用简写
A:::highlight
```

### 内联样式
```
style A fill:#f00,stroke:#333,stroke-width:2px
linkStyle 0 stroke:#ff0000,stroke-width:2px
linkStyle default stroke:#888888
```

---

## 二、时序图 (Sequence Diagram)

### 基本语法
```
sequenceDiagram
    participant A as Alice
    participant B as Bob
    
    A->>B: 同步消息
    B-->>A: 异步返回
    A-)B: 异步消息
    B--)A: 异步返回
```

### 消息类型

| 语法 | 类型 |
|------|------|
| `->>` | 实线带箭头（同步） |
| `-->>` | 虚线带箭头（异步返回） |
| `-)` | 实线开放箭头 |
| `--)` | 虚线开放箭头 |
| `-x` | 实线带 X（失败） |
| `--x` | 虚线带 X（失败返回） |

### 激活框
```
A->>+B: 请求
B-->>-A: 响应
%% + 激活, - 停用
```

### 控制流
```
%% 循环
loop 每秒检查
    A->>B: 心跳
end

%% 条件
alt 成功
    A->>B: 200 OK
else 失败
    A->>B: 500 Error
end

%% 可选
opt 有缓存
    A->>B: 返回缓存
end

%% 并行
par 任务A
    A->>B: 消息1
and 任务B
    A->>C: 消息2
end
```

### 注释
```
Note right of A: 右侧注释
Note left of B: 左侧注释
Note over A,B: 跨参与者注释
```

---

## 三、类图 (Class Diagram)

### 基本语法
```
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound() void
        -sleep() void
    }
    
    Animal <|-- Dog : 继承
    Animal <|-- Cat : 继承
```

### 关系类型

| 语法 | 关系类型 |
|------|---------|
| `<\|--` | 继承 (Inheritance) |
| `*--` | 组合 (Composition) |
| `o--` | 聚合 (Aggregation) |
| `-->` | 关联 (Association) |
| `..>` | 依赖 (Dependency) |
| `..\|>` | 实现 (Realization) |

### 可见性

| 符号 | 含义 |
|------|------|
| `+` | Public |
| `-` | Private |
| `#` | Protected |
| `~` | Package |

### 基数标注
```
Customer "1" --> "*" Order : places
```

---

## 四、ER 图 (Entity Relationship)

### 基本语法
```
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "is in"
```

### 关系基数

| 左侧 | 含义 |
|------|------|
| `\|\|` | 恰好一个 |
| `o\|` | 零个或一个 |
| `}o` | 零个或多个 |
| `}\|` | 一个或多个 |

### 属性定义
```
erDiagram
    CUSTOMER {
        int id PK
        string name
        string email UK
    }
```

---

## 五、状态图 (State Diagram)

### 基本语法
```
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : start
    Processing --> Complete : done
    Processing --> Error : fail
    Complete --> [*]
    Error --> Idle : retry
```

### 特殊标记
- `[*]` — 起始/终止伪状态
- `state "描述" as s1` — 带描述的状态别名

### 复合状态
```
stateDiagram-v2
    state Active {
        [*] --> Running
        Running --> Paused : pause
        Paused --> Running : resume
    }
    
    [*] --> Active
    Active --> [*] : finish
```

### 方向控制
```
stateDiagram-v2
    direction LR
    state Nested {
        direction TB
        A --> B
    }
```

---

## 六、XY 数据图表 (XY Chart)

### 柱状图
```
xychart-beta
    title "月度收入"
    x-axis [1月, 2月, 3月, 4月, 5月, 6月]
    y-axis "收入(万元)" 0 --> 500
    bar [180, 250, 310, 280, 350, 420]
```

### 折线图
```
xychart-beta
    title "用户增长"
    x-axis [1月, 2月, 3月, 4月, 5月, 6月]
    line [1200, 1800, 2500, 3100, 3800, 4500]
```

### 混合图（柱状 + 折线）
```
xychart-beta
    title "销售与趋势"
    x-axis [1月, 2月, 3月, 4月, 5月, 6月]
    bar [300, 380, 280, 450, 350, 520]
    line [300, 330, 320, 353, 352, 395]
```

### 水平方向
```
xychart-beta horizontal
    title "语言流行度"
    x-axis [Python, JavaScript, Java, Go, Rust]
    bar [30, 25, 20, 12, 8]
```

### 多系列
```
xychart-beta
    title "多产品对比"
    x-axis [Q1, Q2, Q3, Q4]
    bar [100, 150, 130, 180]
    bar [80, 120, 140, 160]
    line [90, 135, 135, 170]
```

---

## 七、通用技巧

### 注释
```
%% 这是注释，不会被渲染
```

### 特殊字符
节点标签中需要转义的字符用引号包裹：
```
A["包含 (括号) 的文本"]
B["包含 {花括号} 的文本"]
```

### 多行文本
```
A["第一行<br>第二行<br>第三行"]
```

### 链接样式索引
边的索引从 0 开始，按声明顺序计数：
```
A --> B    %% 索引 0
B --> C    %% 索引 1
C --> D    %% 索引 2
linkStyle 1 stroke:red   %% 给 B-->C 染红
```
