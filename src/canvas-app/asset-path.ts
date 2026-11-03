// Must run before Excalidraw is evaluated: it resolves its font URLs from this
// global. Fonts load relative to this page and the host serves them from the
// canvas MCP server.
;(window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href

export {}
