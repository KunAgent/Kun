# Starlight UI 插件

这是 Kun 的可安装 UI 插件示例,同时包含吉祥物形象槽位和按主题切换的 `stage` 背景:

- `light.stage` 演示路径字符串简写和槽位默认参数。
- `dark.stage` 演示完整的 `{ path, fit, position, opacity }` 对象。
- 明暗主题都被显式声明,因为背景主题之间不会自动回退。

请从 `设置 → 形象工坊 → 安装插件文件夹…` 选择本目录。Kun 只会复制
`manifest.json` 和 `img/` 下被引用的图片;`artwork/` 保存原创矢量源文件,不会安装。
