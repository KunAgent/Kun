# 自定义主题

组件库通用的 Design Token 均使用 CSS Variables 声明，你可以在自己的项目中声明同名变量来覆盖他们的值。

## 全局自定义

小程序的 CSS Variables 全部定义可以在这里看到: [_variables.less](https://github.com/Tencent/tdesign-miniprogram/blob/develop/packages/components/common/style/_variables.less)

如果你想改变主题色，主要改变这几个变量即可：

```css
@brand-color: var(--td-brand-color, #0052d9); // 主题色
@success-color: var(--td-success-color, #00a870); // 成功
@warning-color: var(--td-warning-color, #ed7b2f); // 警告
@error-color: var(--td-error-color, #e34d59); // 失败
```

> ⚠️ 注意：1.0.0 版本之前主题色的变量是 --td-primary-color

在 `app.wxss` 文件添加下行代码即可：

```css
page {
--td-brand-color: navy; // 任何你想要的主题色
}
```

> 当然，[_variables.less](https://github.com/Tencent/tdesign-miniprogram/blob/develop/packages/components/common/style/_variables.less) 里面都是通用的全局变量，都可以修改

## 局部自定义

在 TDesign 小程序里，你也可以只给某个组件修改主题，下面以 `Rate` 举例：

```css
page {
--td-rate-selected-color: #ed7b2f; /* 选中的颜色 */
--td-rate-unselected-color: #e3e6eb; /* 未选中的颜色 */
}
```

## 自定义TabBar

当然，有些组件可能不会被包裹在 `page` 里，比如自定义 `tab-bar`。

此时，可以通过给组件增加 `class` 来实现：

```html
<t-tab-bar class="custom-tab-bar">
<t-tab-bar-item value="home" icon="home">home</t-tab-bar-item>
</t-tab-bar>
```

对应的 `CSS` 可以这么定义：

```css
.custom-tab-bar {
--td-tab-bar-item-color: red;
}
```

> 目前仅有部分组件支持自定义主题，支持的组件在其文档有陈列对应的 CSS Variables，可以访问 [tab-bar-item.less](https://github.com/Tencent/tdesign-miniprogram/blob/develop/packages/components/tab-bar-item/tab-bar-item.less)