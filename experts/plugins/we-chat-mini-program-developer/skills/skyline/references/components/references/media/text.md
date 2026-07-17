# text 与 span 组件

## 概述

Skyline 对文本处理有特殊要求：**内联文本只能使用 text 组件**。同时，Skyline 新增了 `span` 组件用于图文混排，并为 text 组件增加了 `overflow` 和 `max-lines` 属性实现文本溢出处理。

## 核心规则

### MUST（必须遵守）

1. **内联文本必须用 text 组件**
   ```html
   <!-- ✅ 正确 -->
   <text>Hello <text>World</text></text>
   
   <!-- ❌ 错误 -->
   <view>Hello <view>World</view></view>
   ```

2. **text 组件内只能嵌套 text**
   ```html
   <!-- ✅ 正确 -->
   <text>
     <text style="color: red;">红色</text>文字
   </text>
   
   <!-- ❌ 错误 -->
   <text>
     <view>不能嵌套 view</view>
   </text>
   ```

## text 组件

### 通用属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| user-select | boolean | false | 文本是否可选（会使节点变为 inline-block） |

### Skyline 特有属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| overflow | string | visible | 文本溢出处理 |
| max-lines | number | - | 最大行数限制 |

### overflow 属性值

| 值 | 效果 |
|----|------|
| visible | 不截断（默认） |
| clip | 直接裁剪 |
| fade | 渐隐效果 |
| ellipsis | 显示省略号 |

### WebView 特有属性

| 属性 | 类型 | 说明 |
|------|------|------|
| space | string | 显示连续空格：ensp/emsp/nbsp |
| decode | boolean | 是否解码 HTML 实体 |

## 文本溢出处理

### 单行省略

```html
<text 
  overflow="ellipsis" 
  max-lines="1"
  style="width: 200px;"
>
  这是一段很长的文本内容，超出部分会显示省略号
</text>
```

### 多行省略

```html
<text 
  overflow="ellipsis" 
  max-lines="3"
  style="width: 200px;"
>
  这是一段很长的文本内容，
  当文本超过三行时，
  第三行末尾会显示省略号，
  后面的内容会被截断...
</text>
```

### 渐隐效果

```html
<text 
  overflow="fade" 
  max-lines="1"
  style="width: 200px;"
>
  这是一段很长的文本，末尾会渐隐消失
</text>
```

## span 组件

`span` 是 Skyline 新增的内联容器组件，用于实现图文混排。

### 基本用法

```html
<span>
  <image src="icon.png" style="width: 16px; height: 16px;" />
  <text>图文混排内容</text>
</span>
```

### 图标 + 文字

```html
<span class="tag">
  <image class="tag-icon" src="/images/hot.png" />
  <text class="tag-text">热门</text>
</span>
```

```css
.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: #fff5f5;
  border-radius: 4px;
}

.tag-icon {
  width: 14px;
  height: 14px;
  margin-right: 4px;
}

.tag-text {
  font-size: 12px;
  color: #f5222d;
}
```

### 文字 + 链接

```html
<span>
  <text>同意</text>
  <navigator url="/pages/agreement/index">
    <text style="color: #1890ff;">《用户协议》</text>
  </navigator>
  <text>和</text>
  <navigator url="/pages/privacy/index">
    <text style="color: #1890ff;">《隐私政策》</text>
  </navigator>
</span>
```

### 价格显示

```html
<span class="price">
  <text class="currency">¥</text>
  <text class="amount">99</text>
  <text class="decimal">.00</text>
</span>
```

```css
.price {
  display: inline-flex;
  align-items: baseline;
  color: #f5222d;
}

.currency {
  font-size: 12px;
}

.amount {
  font-size: 24px;
  font-weight: bold;
}

.decimal {
  font-size: 12px;
}
```

## 示例代码

### 文章内容

```html
<view class="article">
  <text class="title" max-lines="2" overflow="ellipsis">
    {{article.title}}
  </text>
  <text class="summary" max-lines="3" overflow="ellipsis">
    {{article.summary}}
  </text>
  <span class="meta">
    <image class="avatar" src="{{article.author.avatar}}" />
    <text class="author">{{article.author.name}}</text>
    <text class="time">{{article.time}}</text>
  </span>
</view>
```

```css
.article {
  padding: 16px;
}

.title {
  display: block;
  font-size: 18px;
  font-weight: bold;
  line-height: 1.4;
  color: #333;
}

.summary {
  display: block;
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #666;
}

.meta {
  display: flex;
  align-items: center;
  margin-top: 12px;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  margin-right: 8px;
}

.author {
  font-size: 12px;
  color: #999;
  margin-right: 12px;
}

.time {
  font-size: 12px;
  color: #999;
}
```

### 商品标签

```html
<view class="product-title">
  <span wx:for="{{product.tags}}" wx:key="*this" class="tag {{item}}">
    <text>{{item === 'new' ? '新品' : item === 'hot' ? '热卖' : '特价'}}</text>
  </span>
  <text class="name" max-lines="2" overflow="ellipsis">
    {{product.name}}
  </text>
</view>
```

```css
.product-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.tag {
  padding: 0 4px;
  margin-right: 4px;
  border-radius: 2px;
  font-size: 10px;
}

.tag.new {
  background: #e6f7ff;
  color: #1890ff;
}

.tag.hot {
  background: #fff2e8;
  color: #fa541c;
}

.name {
  flex: 1;
  font-size: 14px;
  color: #333;
  line-height: 1.4;
}
```

### 可选文本

```html
<text user-select class="selectable-text">
  这段文字可以被选中复制
</text>
```

> 注意：设置 `user-select` 后，text 会变为 inline-block 显示

## 注意事项

1. **文本节点**：在 Skyline 中，纯文本必须用 `<text>` 包裹
2. **嵌套规则**：text 内只能嵌套 text，不能嵌套其他组件
3. **长按选中**：除了文本节点外的其他节点都无法长按选中
4. **操作系统差异**：各系统的空格标准不一致
5. **decode**：可解析 `&nbsp;` `&lt;` `&gt;` `&amp;` `&apos;` `&ensp;` `&emsp;`

## WebView vs Skyline 对比

| 特性 | WebView | Skyline |
|------|---------|---------|
| 空格处理 | space 属性 | 不支持 |
| HTML 实体 | decode 属性 | 不支持 |
| 文本溢出 | CSS 实现 | overflow + max-lines |
| 图文混排 | 任意嵌套 | 必须用 span |

## 示例代码片段

{% minicode('LQxYkQmm7fJj') %}
