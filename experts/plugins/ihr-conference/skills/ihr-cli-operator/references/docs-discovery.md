# 在线文档动态发现

`https://hrclaw-docs.ihr360.com/` 是持续迭代的在线文档，不要把当前页面内容复制成固定真相。每次需要接口、命令或参数细节时，从当前页面和当前本机 CLI 重新确认。

## 优先级

1. 用户本轮明确提供的信息
2. 当前本机 `ihr-cli --help`、`ihr-cli <domain> --help`、`ihr-cli <domain> +<verb> --help`
3. 当前在线文档 `https://hrclaw-docs.ihr360.com/`
4. 本 skill 的 references

文档与 CLI 输出冲突时，以当前本机 CLI 为准。

## 发现流程

1. 请求首页。
2. 从 HTML 中解析当前 `build/bundle.<hash>.js`，不要假设 hash 固定。
3. 下载当前 bundle。
4. 提取目录树或按关键词搜索 markdown 内容。
5. 只把提取结果作为本轮任务依据，不要自动提交到 skill 仓库。

## 脚本用法

```bash
python skills/ihr-cli-operator/scripts/extract_ihr_docs.py --toc
python skills/ihr-cli-operator/scripts/extract_ihr_docs.py --search "分页查询花名册"
python skills/ihr-cli-operator/scripts/extract_ihr_docs.py --section "ihr-conference"
python skills/ihr-cli-operator/scripts/extract_ihr_docs.py --dump docs-output/ihr-docs.json
```

脚本会自动获取当前 bundle URL。若文档站结构变化导致脚本失败，退回使用浏览器查看首页和静态资源；不要把一次性 URL、token、cookie 或测试入口写入公开 reference。

## 不要做的事

- 不要硬编码 `bundle.<hash>.js` 文件名。
- 不要把完整在线文档抓取结果提交到 skill。
- 不要根据旧文档猜测当前接口仍然存在。
- 不要把接口示例里的 token、cookie 或一次性参数写入 reference。
- 不要在 reference 示例中写死操作者机器上的绝对文件路径。
