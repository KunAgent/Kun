{
  "targets": [{
    "target_name": "kun_windows_startup",
    "sources": ["startup.cc", "async-startup-lock.cc"],
    "defines": ["NAPI_VERSION=8", "_WIN32_WINNT=0x0601", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
    "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"]}}
  }]
}
