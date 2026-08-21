/**
 * Builds the synthetic design-turn prompt fired after the user annotates an
 * image in the canvas editor and clicks 应用. The flattened annotation is a
 * hidden image-generation reference; the selected visible source shape stays
 * unchanged so the clean result can be added as a separate revision.
 */
export type ImageAnnotationPromptInput = {
  /** Workspace-relative path of the hidden flattened annotation PNG. */
  annotatedRelativePath: string
  /** Typed text labels the user placed on the image (verbatim), e.g. "改成闪电". */
  textNotes?: string[]
  /** Optional free-form instruction typed in the editor's prompt field. */
  instruction?: string
}

function cleanLines(values: readonly string[] | undefined): string[] {
  if (!values) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function buildImageAnnotationPrompt(input: ImageAnnotationPromptInput): string {
  const path = input.annotatedRelativePath.trim()
  const notes = cleanLines(input.textNotes)
  const instruction = input.instruction?.trim()

  const lines: string[] = [
    '我在选中的这张图片上直接画了批注，标出想要的修改：箭头指向要改的地方、框线圈出区域、文字写明改成什么。带批注的图已另存为隐藏参考文件，当前选中的源 image 必须保持不变。',
    '',
    '请按图片编辑（image-to-image）的方式处理：',
    `1. 调用 generate_image，reference_image_paths 传入这张带批注的图：\`${path}\`，保持 aspect_ratio 与该 shape 的宽高比一致。`,
    '2. 把批注理解为修改指令去执行：只改批注指向/圈出的部分，图片其余的构图、风格、配色和未被标注的内容都尽量保持不变。',
    '3. 结果里【不要】保留这些手绘批注本身（红色箭头、框线、文字标签都不能出现在最终图里），输出一张干净的成品图。',
    '4. 不要 update 或删除选中的源 shape；renderer 会把返回的新图作为同尺寸的新版本放在源图旁边。',
    '这是一次图片编辑，不要新建页面 / screen，也不要写或改任何 HTML 文件。'
  ]

  if (notes.length > 0) {
    lines.push('', '图上的文字批注（逐条对应一处修改）：')
    for (const note of notes) lines.push(`- ${note}`)
  }

  if (instruction) {
    lines.push('', `补充说明：${instruction}`)
  }

  return lines.join('\n')
}

/** Short, friendly bubble shown in the chat timeline for an annotation turn. */
export function imageAnnotationDisplayText(input: { textNotes?: string[]; instruction?: string }): string {
  const instruction = input.instruction?.trim()
  if (instruction) return `按图片批注修改：${instruction}`
  const notes = cleanLines(input.textNotes)
  if (notes.length > 0) return `按图片批注修改：${notes.join('、')}`
  return '按图片上的批注修改这张图'
}
