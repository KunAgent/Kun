abi <abi/4.0>,
include <tunables/global>

# Unprivileged user namespaces are denied to any program without a profile that
# grants them, and the Chromium sandbox needs one. The launcher at
# /opt/<product>/<executable> re-executes the real Electron binary, renamed
# <executable>.electron-bin, so the profile must attach to both: the process
# that creates the sandbox is the renamed binary, not the launcher.
profile "${executable}" "/opt/${sanitizedProductName}/{${executable},${executable}.electron-bin}" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
