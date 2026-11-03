# Windows 0.4.1 to 0.4.2 update: temporary safety guidance

This is a containment guide for [issue #1421](https://github.com/KunAgent/Kun/issues/1421),
not a verified repair or successful upgrade procedure. Do not apply one user's
cleanup steps to another installation. Native Windows installer/recovery
validation is required before prescribing a repair command.

## Choose the current state, not the original report

### A. The failed update is intact and 0.4.1 still works

- Continue using the currently working instance temporarily. Do not click
  Update/Retry, repeatedly restart, uninstall, or install another copy over it.
- Preserve the installation and recovery files in place. In particular, do not
  remove `KunInstallerRecovery`, `update-backup-*`, `Kun.kun-stage-*`,
  `Kun.kun-old-*`, or hidden `.kun-installer-preserved-*` folders. A folder's
  name or age does not prove it is disposable.
- Follow the data backup and diagnostic steps below before further changes.
  A working old executable alone does not prove that rollback completed.

### B. Manual 0.4.2 now works from a stage directory and old files were deleted

The [reporter's follow-up](https://github.com/KunAgent/Kun/issues/1421#issuecomment-6408239260)
says shortcuts and uninstall registration point to
`Programs\Kun.kun-stage-232156\Kun.exe`; 0.4.2 subsequently started successfully,
and the old `Programs\Kun`, backups, cache, and another stage were deleted.
These are reporter observations, not a validated recovery procedure.

- **Do not delete, rename, or move the stage directory now hosting the working
  application.** It is the active installation despite its temporary-looking
  name. Stop further cleanup and update retries.
- Keep using only the existing working instance if its data is normal. Do not
  launch an old copy alongside it or start executables from recovery folders.
  The reported first-start timeout stopped recurring after the old instance
  exited; this does not establish every timeout's cause.
- Do not recreate the old installation directory, edit registry/shortcut
  targets, run an uninstaller, or invoke rollback against missing backups.
  Deleted rollback material cannot be assumed recoverable.
- Record the current executable path, shortcut target, registration paths,
  version, and which recovery files still exist. A repair must be chosen for
  this changed state, not for the original intact `prepared` transaction.

## Back up essential user data, preserve recovery material

Save work and normally quit Kun before making a consistent data backup. Wait
for its owned processes and any installer/recovery operation to finish. If
ownership is unclear or processes do not exit, stop and ask for help; do not
force-kill all Node processes or processes using a particular port.

Copy (do not move) the user's data to a separate, private backup location with
sufficient space:

- GUI profile: normally `%APPDATA%\Kun`.
- The **actual configured runtime data directory**: normally
  `%USERPROFILE%\.kun\data`; an older profile may use
  `%USERPROFILE%\.deepseekgui\kun`, or a custom directory. Read the existing
  configuration to identify it; do not change it to get a fresh startup.
- User projects/files outside those directories that have no other backup.

Verify the copy completed without errors. Do not claim a live database copy or
an incomplete copy is a consistent backup. If there is insufficient space or
copying fails, stop rather than deleting recovery files to make room.

Keep existing installation/recovery/stash directories unchanged in place.
There is no need to blindly duplicate every overlapping transaction path.
If an additional recovery snapshot is needed, first identify its unique roots,
ownership and required space. Never upload a bulk data/profile backup.

## Minimal read-only evidence for a maintainer

Before changing anything, record:

1. Current version and executable location. Windows Task Manager's **Open file
   location** and file Properties can identify the running Kun executable;
   do not launch another copy for this check. Record the shortcut's Target.
2. Existing current-user Kun uninstall registration's `InstallLocation` and
   `UninstallString`, and install registration path, if accessible. Inspect
   values only; do not execute the uninstall string or edit the registry.
   If unsure which key belongs to Kun, ask a maintainer rather than guessing.
3. Which original/current/stage/backup/stash directories still exist, and which
   were already deleted. Do not create missing directories or files.
4. The relevant `%TEMP%\Kun-installer-migration-*.log` (or the diagnostic path
   shown by the installer), the matching `<app-guid>.json` preservation journal
   and `<app-guid>-update.json` transaction under
   `%APPDATA%\KunInstallerRecovery`, and whether the GUI profile contains
   `pending-update.json`, `pending-update-result.json`, or
   `gui-update-recovery.json`. Missing files are useful evidence; leave them missing.

Provide only relevant, redacted log/JSON excerpts through an appropriate support
channel. Preserve phase, path relationships and action order, but redact user
names, health tokens, credentials and private content. Never publish settings,
API keys, conversations, or the entire data directory. Keep originals private.

Stop further repair attempts if startup/data is abnormal, there is a recovery
loop, `rollback_incomplete`, `restore-conflict`, missing required backup, an
unexpected process owner, or a backup/read error. Do not bypass these conditions
by deleting pending records, changing transaction phases/paths, or creating an
empty `.health.json`.

## Why these limits matter

Verified against v0.4.2 source (`a9060246`):

- `Initialize-UpdateTransaction` records `prepared` before `Invoke-Prepare`
  moves unknown install-directory entries into the preservation stash.
  `CompletedMutations=[]` therefore does not mean user files were not moved.
- Health-result authorization compares expected paths; absence of the result
  file does not justify bypassing authorization.
- Manual installation skips `RecoverUpdateTransaction`; manual success alone
  does not prove the previous automatic transaction was safely retired.
- GUI reconciliation can call the transaction finalizer after repeated aborted
  attempts. Repeated restarts are not always passive. Relevant GUI reconciliation,
  bootstrap and phase-policy source is identical in v0.4.1 and v0.4.2.
- `prepared` forbids backup deletion/new installation, and even `committed`
  retains rollback material until application health and finalization complete.

The original Prepare-to-no-Switch report and the later stage registration are
separate observations requiring installer action-order/registration evidence.
Source changes or passing mock tests alone do not establish a native repair.
The recovery implementation under development is not a released, field-ready
CLI procedure. This guide intentionally provides no mutating repair commands.
