# End-to-End Deploy Example (Segmentation → Orchestration → Generation → Optimization → Deployment)

> Note: Outputs in this example are illustrated in English for clarity. Actual output language follows `references/data-contracts.md#language-resolution` (e.g., Chinese invocation → Chinese output).

## Input Payload (example)

```json
{
  "course_material": "Module transcript: observe metric drift, classify causes, apply one fix, review impact.",
  "generation_constraints": {
    "persona": "practical coach",
    "lesson_granularity": "short"
  },
  "course_profile": {
    "audience_level": "beginner",
    "lesson_duration_minutes": 10,
    "lesson_count_target": 3,
    "assessment_mode": "project"
  },
  "platform_region": "cn",
  "target_language": "zh-CN"
}
```

## Segmentation through Optimization (Author)

Produces optimized Teaching Prompts (see `pipeline-full.md` for detailed output).

## Deployment Output

### Step 1: Build Course Directory

```
my-course/
  README.md
  course-description.md
  course-prompt.md
  structure.json
  lessons/
    lesson-01.md
    lesson-02.md
    lesson-03.md
```

### Step 2: Build Import File

`course-description.md` contains the generated SEO/listing description for the course.

```bash
python3 {skillDir}/scripts/shifu-cli.py build --course-dir ./my-course/ --title "Metric Drift Diagnosis"
```

Output: `my-course/shifu-import.json`

### Step 3: Import and Publish

```bash
python3 {skillDir}/scripts/shifu-cli.py import --new --json-file ./my-course/shifu-import.json
# Returns: shifu_bid = abc123-def456

python3 {skillDir}/scripts/shifu-cli.py publish abc123-def456
```

### Step 4: Verify

```bash
python3 {skillDir}/scripts/shifu-cli.py show abc123-def456
```

Platform URLs (copied verbatim from the `Verification URLs:` block printed by `publish` / `import` / `show` — do not reconstruct them; render each as Markdown link + bare URL + a Chinese-description line per `references/report-template.md`):

- [我的课程 - 管理后台](https://app.ai-shifu.cn/shifu/abc123-def456)
  https://app.ai-shifu.cn/shifu/abc123-def456
  点击会跳转到 AI 师傅管理后台，用于设置章节状态、收费与否，以及手工调整课程细节、调试 AI 一对一授课的效果。调试时会消耗课程创建者在 AI 师傅的积分。
- [我的课程 - 预览课程](https://app.ai-shifu.cn/c/abc123-def456?preview=true)
  https://app.ai-shifu.cn/c/abc123-def456?preview=true
  点击会跳转到 AI 师傅课程预览页，仅课程作者本人可见，用于正式发布前自测课程草稿的效果；预览会消耗课程创建者在 AI 师傅的积分。
- [我的课程 - 课程学习](https://app.ai-shifu.cn/c/abc123-def456)
  https://app.ai-shifu.cn/c/abc123-def456
  点击会跳转到 AI 师傅课程学习页，可以发送给学员使用且仅在课程已发布后有效；任何人学习都会消耗课程创建者在 AI 师傅的积分。

## Acceptance Notes

- All pipeline stages executed end-to-end.
- Teaching Prompts (MarkdownFlow) written to course directory, built, imported, and published.
- Course is live and accessible via platform URL.
