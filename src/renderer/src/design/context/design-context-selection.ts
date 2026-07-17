import { z } from 'zod'

const DesignContextSelectionSchema = z.object({
  version: z.literal(1),
  selected: z.array(z.object({
    contributionId: z.string().min(1),
    version: z.string().min(1),
    enabled: z.boolean()
  }))
})

export type DesignContextSelection = z.infer<typeof DesignContextSelectionSchema>
export const DESIGN_CONTEXT_SELECTION_PATH = '.kun-design/context.json'

export async function loadDesignContextSelection(workspaceRoot: string): Promise<DesignContextSelection> {
  if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') {
    return { version: 1, selected: [] }
  }
  const response = await window.kunGui.readWorkspaceFile({
    workspaceRoot,
    path: DESIGN_CONTEXT_SELECTION_PATH
  })
  if (!response.ok) return { version: 1, selected: [] }
  const parsed = DesignContextSelectionSchema.safeParse(JSON.parse(response.content))
  return parsed.success ? parsed.data : { version: 1, selected: [] }
}

export async function saveDesignContextSelection(
  workspaceRoot: string,
  selection: DesignContextSelection
): Promise<void> {
  const validated = DesignContextSelectionSchema.parse(selection)
  if (!workspaceRoot || typeof window.kunGui?.writeWorkspaceFile !== 'function') {
    throw new Error('Workspace file API is unavailable')
  }
  const response = await window.kunGui.writeWorkspaceFile({
    workspaceRoot,
    path: DESIGN_CONTEXT_SELECTION_PATH,
    content: JSON.stringify(validated, null, 2)
  })
  if (!response.ok) throw new Error(response.message)
}
