/** Pure config templates shared by managed launches and standalone setup previews. */
/** Generated opencode.json: single `kun` provider; the key stays an env ref. */
export function opencodeConfig(
  baseUrl: string,
  gatewayModelId: string,
  tokenEnv: string
): string {
  return `${JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        kun: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Kun',
          options: { baseURL: baseUrl, apiKey: `{env:${tokenEnv}}` },
          models: { [gatewayModelId]: { name: gatewayModelId } }
        }
      },
      model: `kun/${gatewayModelId}`
    },
    null,
    2
  )}\n`
}

/**
 * Generated PI_CODING_AGENT_DIR/models.json (P6-11): a single `kun` provider
 * on the openai-completions surface. `apiKey` is pi's `$NAME` env
 * interpolation — the grant token only ever lives in the child env.
 */
export function piModelsConfig(
  baseUrl: string,
  gatewayModelId: string,
  tokenEnv: string
): string {
  return `${JSON.stringify(
    {
      providers: {
        kun: {
          baseUrl,
          api: 'openai-completions',
          apiKey: `\${${tokenEnv}}`,
          models: [{ id: gatewayModelId, name: gatewayModelId }]
        }
      }
    },
    null,
    2
  )}\n`
}

/** Generated CODEX_HOME/config.toml: `kun` provider, key via `env_key`. */
export function codexConfig(
  baseUrl: string,
  gatewayModelId: string,
  tokenEnv: string
): string {
  return [
    'model_provider = "kun"',
    `model = ${JSON.stringify(gatewayModelId)}`,
    'preferred_auth_method = "apikey"',
    '',
    '[model_providers.kun]',
    'name = "Kun"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    `env_key = ${JSON.stringify(tokenEnv)}`,
    'wire_api = "responses"',
    ''
  ].join('\n')
}
