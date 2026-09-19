/** Windows-only launcher. The target is assigned to its Job before its first instruction. */
export const WINDOWS_OWNED_LAUNCHER_SOURCE = String.raw`
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class KunOwnedLauncher {
  // lpReserved/lpDesktop/lpTitle must stay IntPtr: as managed LPWSTR strings the
  // marshaller would CoTaskMemFree pointers that live inside our own startup
  // block when the out struct is marshaled back, corrupting the process heap.
  [StructLayout(LayoutKind.Sequential)]
  struct StartupInfo {
    public int cb; public IntPtr reserved; public IntPtr desktop; public IntPtr title;
    public uint x, y, xSize, ySize, xCount, yCount, fill, flags;
    public short showWindow, cbReserved2; public IntPtr lpReserved2;
    public IntPtr stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long processTime, jobTime; public uint flags;
    public UIntPtr minWorkingSet, maxWorkingSet; public uint activeLimit;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io;
    public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Accounting {
    public long userTime, kernelTime, periodUser, periodKernel;
    public uint pageFaults, totalProcesses, activeProcesses, terminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern void GetStartupInfo(out StartupInfo startup);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok, string operation) {
    if (!ok) throw new InvalidOperationException(operation + " failed (" + Marshal.GetLastWin32Error() + ")");
  }
  static string Decode(string line) { return Encoding.UTF8.GetString(Convert.FromBase64String(line)); }
  static long Birth(Process process) { return process.StartTime.ToUniversalTime().ToFileTimeUtc(); }

  public static int Main() {
    IntPtr job = IntPtr.Zero;
    ProcessInfo target = new ProcessInfo();
    string statusPath = null;
    try {
      string[] config = File.ReadAllLines(Environment.GetEnvironmentVariable("KUN_OWNED_LAUNCH_CONFIG"));
      string executable = Decode(config[0]), command = Decode(config[1]), cwd = Decode(config[2]);
      statusPath = Decode(config[3]);
      string stagePath = statusPath + ".stage";
      Action<string> mark = (stage) => { try { File.WriteAllText(stagePath, stage); } catch { } };
      mark("config");
      string stopPath = Decode(config[4]);
      int ownerPid = int.Parse(config[5], CultureInfo.InvariantCulture);
      long expectedBirth = long.Parse(config[6], CultureInfo.InvariantCulture);
      int ownerGrace = int.Parse(config[7], CultureInfo.InvariantCulture);
      using (Process owner = Process.GetProcessById(ownerPid)) {
        // Opening a process handle before launch avoids PID reuse and tracks
        // the top application owner even when an intermediate Runtime dies.
        IntPtr ownerHandle = owner.Handle;
        long ownerBirth = Birth(owner);
        if (owner.HasExited || (expectedBirth != 0 && ownerBirth != expectedBirth))
          throw new InvalidOperationException("Application process identity changed before launch");
        mark("owner");
        job = CreateJobObject(IntPtr.Zero, null);
        Check(job != IntPtr.Zero, "CreateJobObject");
        ExtendedLimits limits = new ExtendedLimits();
        limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
        Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "SetInformationJobObject");
        mark("job");
        Environment.SetEnvironmentVariable("KUN_PROCESS_STACK_OWNER_PID", ownerPid.ToString(CultureInfo.InvariantCulture));
        Environment.SetEnvironmentVariable("KUN_PROCESS_STACK_OWNER_BIRTH", ownerBirth.ToString(CultureInfo.InvariantCulture));
        Environment.SetEnvironmentVariable("KUN_OWNED_LAUNCH_CONFIG", null);
        StartupInfo startup;
        GetStartupInfo(out startup);
        startup.cb = Marshal.SizeOf(typeof(StartupInfo));
        // Preserve libuv's inherited CRT descriptor table, including Node IPC
        // fd 3, in addition to stdin/stdout/stderr. No proxy reads those pipes.
        Check(CreateProcess(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero,
          true, 0x00000004 | (config[8] == "console" ? 0u : 0x08000000u), IntPtr.Zero, cwd, ref startup, out target), "CreateProcess");
        mark("create");
        Check(AssignProcessToJobObject(job, target.process), "AssignProcessToJobObject");
        mark("assign");
        if (WaitForSingleObject(ownerHandle, 0) == 0)
          throw new InvalidOperationException("Application exited during process launch");
        File.WriteAllText(statusPath + ".tmp", target.pid.ToString(CultureInfo.InvariantCulture));
        File.Move(statusPath + ".tmp", statusPath);
        mark("status");
        string startPath = Decode(config[9]);
        long launchDeadline = DateTime.UtcNow.Ticks + TimeSpan.FromSeconds(10).Ticks;
        while (!File.Exists(startPath)) {
          if (WaitForSingleObject(ownerHandle, 0) == 0 || File.Exists(stopPath) || DateTime.UtcNow.Ticks > launchDeadline)
            throw new InvalidOperationException("Application cancelled suspended process launch");
          Thread.Sleep(5);
        }
        Check(ResumeThread(target.thread) != 0xffffffff, "ResumeThread");
        mark("resume");
        long ownerLostAt = 0;
        bool terminated = false;
        for (;;) {
          Accounting accounting;
          Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "QueryInformationJobObject");
          if (accounting.activeProcesses == 0) break;
          long now = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
          if (ownerLostAt == 0 && WaitForSingleObject(ownerHandle, 0) == 0) ownerLostAt = now;
          if (!terminated && (File.Exists(stopPath) || (ownerLostAt != 0 && now - ownerLostAt >= ownerGrace - 1000))) {
            Check(TerminateJobObject(job, 1), "TerminateJobObject");
            terminated = true;
          }
          if (ownerLostAt != 0 && now - ownerLostAt > ownerGrace) return 70;
          Thread.Sleep(25);
        }
        uint exitCode;
        Check(GetExitCodeProcess(target.process, out exitCode), "GetExitCodeProcess");
        return (int)exitCode;
      }
    } catch (Exception error) {
      if (statusPath != null) {
        try { File.WriteAllText(statusPath, "error:" + error.Message); } catch { }
      }
      try { Console.Error.WriteLine("kun-owned-launcher: " + error); } catch { }
      return 70;
    } finally {
      // Also terminate a suspended target if assigning the job failed.
      if (target.process != IntPtr.Zero) TerminateProcess(target.process, 70);
      if (job != IntPtr.Zero) { TerminateJobObject(job, 70); CloseHandle(job); }
      if (target.thread != IntPtr.Zero) CloseHandle(target.thread);
      if (target.process != IntPtr.Zero) CloseHandle(target.process);
    }
  }
}
`;
