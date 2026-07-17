---
name: bgm-prompting
description: |
  产品宣传片BGM Prompt工程参考资料。
  包含Mureka/Skywork Music Maker的prompt规则、产品宣传片BGM的anti-convergence规则和已验证的默认双轨方向。
  触发词：配乐、BGM、音乐prompt、卡点、Mureka
---

# BGM Prompting

## 功能说明
提供产品宣传片 BGM 的 prompt 工程规范和 Mureka 音乐生成脚本。

## 参考资料
- `@references/mureka_prompt_guide.md` — Mureka AI 音乐 Prompt 编写完整指南
- `@references/product_promo_bgm_prompting.md` — 产品宣传片 BGM 的 anti-convergence 规则和 5 条已验证 lane

## 调用方式
- 音乐生成：`python scripts/mureka.py instrumental --prompt "<prompt>" -n 3 --format mp3 --output assets/bgm/`

## 核心原则
1. Prompt 用英文，描述音乐本身，不写命令句
2. 必须包含：specific genre、BPM/tempo、3-5 instruments、mood、dynamic arc、instrumental only
3. 默认生成 2-3 个候选，不只生成 1 个
4. 备选方向必须在 6 个维度中改变至少 4 个
5. 迭代时一次只改一个变量
