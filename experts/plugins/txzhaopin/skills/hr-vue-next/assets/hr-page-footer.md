# PageFooter 页脚组件

页脚组件，用于展示页面底部的版权信息和联系人信息。

## 基础用法

### 基础示例

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-footer />
    </div>
  </div>
</template>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

### 自定义部门和联系人

通过 `department` 属性设置业务部门，`username` 属性设置联系人名称。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-footer department="人力资源平台部" username="cxyxhhuang(黄鑫杰)"></hr-page-footer>
    </div>
  </div>
</template>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

## API

### Props

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| department | 业务部门 | String | - | - |
| username | 用户名称 | String | - | 小T(连线HR) |
