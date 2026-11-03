/**
 * Account-catalog fixture for Codex subscription image tests. The client reads
 * the ChatGPT account catalog before it picks the outer Responses model, so
 * every Codex image stub must answer that request separately from the image
 * stream it is testing.
 */
export const CODEX_MODEL_CATALOG_URL = 'https://chatgpt.com/backend-api/codex/models'

export const CODEX_TEST_OUTER_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'] as const

export function isCodexModelCatalogRequest(url: string | URL): boolean {
  return String(url).startsWith(CODEX_MODEL_CATALOG_URL)
}

export function codexModelCatalogResponse(
  models: readonly string[] = CODEX_TEST_OUTER_MODELS
): Response {
  return Response.json({
    models: models.map((slug) => ({ slug, visibility: 'list' }))
  })
}
