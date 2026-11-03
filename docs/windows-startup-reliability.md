# Windows startup coordination

Kun continues to use an application-owned Manager and Runtime. A single
canonical profile has one application owner and one business-data writer.
Startup recovery does not authorize stopping a process based on a PID, port,
timeout, or stale timestamp alone.

## Packaged native components

The existing Windows startup bundle contains a Node-API module and the owned
Job launcher under `kun/dist/native/win32-<arch>`. The build compiles these
components on Windows; installed startup does not compile a launcher or query
process birth identity through PowerShell. The loader verifies the bundle's
architecture and file hashes. The existing after-sign hook recomputes hashes
from packaged binaries after the configured signing step. A hash detects
incomplete or corrupt installation, not an attacker who can replace both a
binary and its manifest.

The launcher still assigns the suspended child to a Job before allowing it to
run and tracks the exact owner and owned tree. Process identity retains the
legacy `win32-v1:` UTC representation. An inaccessible or unknown process is
not evidence that its owner is dead.

## Startup lock and release gate

The shared lock records a scope, phase, elapsed wait, attempt ID, and the
observed owner state. It catches `EEXIST` only during lock acquisition, uses a
monotonic deadline, and propagates cancellation. Incomplete or unverifiable
legacy metadata is preserved when it cannot be safely reclaimed. Manager and
all canonical profile elections use the same deadline and diagnostics.

The Windows bundle also contains an asynchronous candidate lock implementation.
It uses a stable `LockFileEx` guard and holds the existing legacy lock file with
write and delete sharing denied. The caller owns the handles. Acquisition,
publication, and release run in the Node-API worker pool, and deletion of the
held legacy file is by handle. Tests cover hard links, legacy holders and
reclaimers, multiple processes, and process death during admission.

**The candidate protocol is disabled.** Windows continues to use the shared
legacy lock protocol, including its existing read/compare/unlink limitation,
until native concurrency, installed-app, and old/new GUI and TUI acceptance
have passed. Passing macOS or mocked tests is not a Windows release gate. The
candidate must not be enabled solely because its helper compiled.

## Startup and recovery

An owned Manager attempt shares a monotonic budget across profile elections,
previous-owner checks, Manager launch, Runtime readiness, and cleanup. Quit
cancels admission, and the launch gate checks for cancellation before starting
work. The existing session ownership, writer fencing, and quit barriers remain
in place.

An owned Manager that exits before readiness may retry once only after its
owned process tree has been successfully reaped. Unknown identity, active
participants, permission errors, damaged installation, and timeout never grant
permission to terminate another process. Recorded orphan participants use the
existing explicit Recover flow and identity checks. Recovery remains
single-flight while cleanup is still running, even after a timeout or Quit.

Copied diagnostics contain allowlisted startup facts only. Home-directory
paths are redacted; raw error causes, log text, environment variables, and
conversation content are not copied. Logs remain available separately.

## Validation and release evidence

The Windows recovery workflow exercises the existing process-identity and Job
lifecycle tests, the native lock candidates, session fencing, cancellation,
startup deadlines, and recovery presentation. Installer and update-handoff
smoke checks exercise the packaged helper using a fresh temporary directory.

Before enabling the candidate protocol or publishing claims of Windows
recovery, retain successful Windows CI and packaged installer evidence, then
complete real-system testing for rapid GUI double launch, mixed old/new GUI and
TUI handoff, standard and elevated users, multiple logins, ACL denial, Chinese
and spaced paths, junction and case aliases, slow CPU/disk, and cancelled
updates. Verify data preservation, single-writer fencing, and process-tree
cleanup throughout. No network-filesystem guarantee is implied.
