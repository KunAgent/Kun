{
  "targets": [{
    "target_name": "kun_windows_startup",
    "sources": ["startup.cc"],
    "defines": ["NAPI_VERSION=8", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
    "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1}}
  }]
}
