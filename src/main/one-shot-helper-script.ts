/** Independent deadlines for the narrowly scoped installer/uninstaller handoff.
 * These helpers intentionally outlive the old GUI, but never become services. */
export const ONE_SHOT_HELPER_TIMEOUT_SECONDS = 300

export function powershellHelperDeadline(
  seconds = ONE_SHOT_HELPER_TIMEOUT_SECONDS,
  containChildren = false
): string {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3_600) throw new Error('Invalid helper deadline')
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Diagnostics;',
    'using System.Runtime.InteropServices;',
    'using System.Threading;',
    'public static class KunOneShotDeadline {',
    '  static Timer timer;',
    '  static IntPtr job;',
    '  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {',
    '    public long processTime, jobTime; public uint flags; public UIntPtr minWorking, maxWorking;',
    '    public uint activeLimit; public UIntPtr affinity; public uint priority, scheduling;',
    '  }',
    '  [StructLayout(LayoutKind.Sequential)] struct IoCounters {',
    '    public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;',
    '  }',
    '  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {',
    '    public BasicLimits basic; public IoCounters io;',
    '    public UIntPtr processMemory, jobMemory, peakProcess, peakJob;',
    '  }',
    '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);',
    '  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr handle, int kind, ref ExtendedLimits limits, uint length);',
    '  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr handle, IntPtr process);',
    '  public static void Start(int milliseconds, bool contain) {',
    '    if (contain) {',
    '      job = CreateJobObject(IntPtr.Zero, null);',
    '      ExtendedLimits limits = new ExtendedLimits(); limits.basic.flags = 0x2000;',
    '      if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) ||',
    '          !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))',
    '        throw new InvalidOperationException("Cannot contain the one-shot uninstall helper");',
    '    }',
    '    timer = new Timer(delegate { Environment.Exit(124); }, null, milliseconds, Timeout.Infinite);',
    '  }',
    '}',
    "'@",
    `[KunOneShotDeadline]::Start(${seconds * 1_000}, $${containChildren ? 'true' : 'false'})`
  ].join('\n')
}

export function encodePowershellCommand(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64')
}
