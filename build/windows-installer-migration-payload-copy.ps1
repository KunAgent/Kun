# Windows PowerShell 5.1's provider and legacy .NET path normalization can reject
# deep installed payloads. Use Unicode Win32 APIs with extended-length paths;
# this does not require LongPathsEnabled, PowerShell 7, or global runtime switches.
if (-not ('KunInstallerPayloadCopy' -as [type])) {
  # NSIS's plugin directory contains a native System.dll. CodeDOM's default
  # short references can bind that file instead of the framework assembly.
  # CompilerParameters replaces those defaults; use already-loaded framework
  # locations, never the working directory or a caller-provided assembly path.
  $payloadCompiler = [System.CodeDom.Compiler.CompilerParameters]::new()
  $payloadCompiler.GenerateInMemory = $true
  $payloadCompiler.CompilerOptions = '/nostdlib'
  [void]$payloadCompiler.ReferencedAssemblies.Add([System.Object].Assembly.Location)
  [void]$payloadCompiler.ReferencedAssemblies.Add([System.ComponentModel.Win32Exception].Assembly.Location)
  Add-Type -CompilerParameters $payloadCompiler -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

public static class KunInstallerPayloadCopy {
  const uint Invalid = 0xffffffff, Directory = 0x10, Reparse = 0x400, ReadOnly = 1;
  static readonly IntPtr InvalidHandle = new IntPtr(-1);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct FindData {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint SizeHigh, SizeLow, Reserved0, Reserved1;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string Alternate;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct FileData {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint SizeHigh, SizeLow;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool GetFileAttributesExW(string path, int level, out FileData data);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFileAttributesW(string path);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool SetFileAttributesW(string path, uint attributes);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr FindFirstFileW(string path, out FindData data);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool FindNextFileW(IntPtr handle, out FindData data);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool FindClose(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateDirectoryW(string path, IntPtr security);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CopyFileW(string source, string destination, bool failIfExists);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool DeleteFileW(string path);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool RemoveDirectoryW(string path);

  static Exception Error(string operation, string path) {
    return new IOException(operation + ": " + path, new Win32Exception(Marshal.GetLastWin32Error()));
  }
  static string Extended(string path) {
    return path.StartsWith(@"\\") ? @"\\?\UNC\" + path.Substring(2) : @"\\?\" + path;
  }
  static uint Attributes(string path, bool optional) {
    uint attributes = GetFileAttributesW(path);
    if (attributes == Invalid) {
      int error = Marshal.GetLastWin32Error();
      if (optional && (error == 2 || error == 3)) return Invalid;
      throw Error("Cannot inspect payload", path);
    }
    if ((attributes & Reparse) != 0) throw new IOException("Payload contains a reparse point: " + path);
    return attributes;
  }
  static List<string> Children(string path) {
    var names = new List<string>();
    FindData data;
    IntPtr handle = FindFirstFileW(path + @"\*", out data);
    if (handle == InvalidHandle) {
      if (Marshal.GetLastWin32Error() == 2) return names;
      throw Error("Cannot enumerate payload", path);
    }
    try {
      do {
        if (data.Name != "." && data.Name != "..") names.Add(data.Name);
      } while (FindNextFileW(handle, out data));
      if (Marshal.GetLastWin32Error() != 18) throw Error("Cannot enumerate payload", path);
    } finally { FindClose(handle); }
    return names;
  }
  static void ValidateTree(string path, bool optional) {
    uint attributes = Attributes(path, optional);
    if (attributes == Invalid || (attributes & Directory) == 0) return;
    foreach (string name in Children(path)) ValidateTree(path + @"\" + name, false);
  }
  // Check every existing ancestor, including dangling links, before any write.
  static void ValidateAncestors(string path) {
    string current = path;
    while (!String.IsNullOrEmpty(current)) {
      Attributes(Extended(current), true);
      current = Path.GetDirectoryName(current);
    }
  }
  static void EnsureDirectory(string path) {
    uint attributes = Attributes(path, true);
    if (attributes != Invalid) {
      if ((attributes & Directory) == 0) throw new IOException("Payload destination is not a directory: " + path);
      return;
    }
    int separator = path.LastIndexOf('\\');
    EnsureDirectory(path.Substring(0, separator));
    if (!CreateDirectoryW(path, IntPtr.Zero)) throw Error("Cannot create payload directory", path);
  }
  static void CopyTree(string source, string destination) {
    uint attributes = Attributes(source, false);
    uint existing = Attributes(destination, true);
    if ((attributes & Directory) != 0) {
      EnsureDirectory(destination);
      foreach (string name in Children(source)) CopyTree(source + @"\" + name, destination + @"\" + name);
    } else {
      if (existing != Invalid && (existing & Directory) != 0) throw new IOException("Payload file conflicts with directory: " + destination);
      if (existing != Invalid && (existing & ReadOnly) != 0 && !SetFileAttributesW(destination, existing & ~ReadOnly)) {
        throw Error("Cannot replace read-only payload file", destination);
      }
      if (!CopyFileW(source, destination, false)) throw Error("Cannot copy payload to " + destination, source);
    }
  }
  static void DeleteTree(string path) {
    uint attributes = Attributes(path, false);
    if ((attributes & Directory) != 0) {
      foreach (string name in Children(path)) DeleteTree(path + @"\" + name);
    }
    if ((attributes & ReadOnly) != 0 && !SetFileAttributesW(path, attributes & ~ReadOnly)) throw Error("Cannot clear read-only payload", path);
    bool deleted = (attributes & Directory) != 0 ? RemoveDirectoryW(path) : DeleteFileW(path);
    if (!deleted) throw Error("Cannot remove stale payload backup", path);
  }
  public static void Validate(string path) {
    ValidateAncestors(path);
    ValidateTree(Extended(path), false);
  }
  static void ValidateLiteralInspectionAncestors(string path) {
    // Do not invoke legacy System.IO normalization on the very long path being
    // diagnosed. Accept only ordinary absolute drive/UNC paths with literal,
    // normalized segments; device namespaces and traversal are not diagnostic
    // escape hatches. Mutation APIs retain their existing validation unchanged.
    if (String.IsNullOrEmpty(path) || path.IndexOf('/') >= 0) throw new IOException("Invalid literal inspection path.");
    int rootLength;
    if (path.Length >= 3 && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) &&
        path[1] == ':' && path[2] == '\\') {
      rootLength = 3;
    } else if (path.StartsWith(@"\\") && !path.StartsWith(@"\\?\") && !path.StartsWith(@"\\.\")) {
      int serverEnd = path.IndexOf('\\', 2);
      if (serverEnd <= 2 || serverEnd == path.Length - 1) throw new IOException("Invalid UNC inspection root.");
      int shareEnd = path.IndexOf('\\', serverEnd + 1);
      rootLength = shareEnd < 0 ? path.Length : shareEnd;
      if (rootLength == serverEnd + 1) throw new IOException("Invalid UNC inspection root.");
    } else {
      throw new IOException("Inspection requires an absolute drive or UNC path.");
    }
    string segments = path.StartsWith(@"\\") ? path.Substring(2) : path.Substring(3);
    foreach (string segment in segments.TrimEnd('\\').Split('\\')) {
      if (segment == "." || segment == ".." || segment.IndexOfAny(new char[] { ':', '*', '?', '"', '<', '>', '|', '\0' }) >= 0 ||
          (segment.Length == 0 && segments.Length != 0)) throw new IOException("Inspection requires normalized literal segments.");
    }
    string current = path;
    while (current.Length > rootLength && current.EndsWith(@"\")) current = current.Substring(0, current.Length - 1);
    while (true) {
      Attributes(Extended(current), true);
      if (current.Length <= rootLength) break;
      int separator = current.LastIndexOf('\\');
      current = separator < rootLength ? path.Substring(0, rootLength) : current.Substring(0, separator);
    }
  }
  // Diagnostic only: exact literal metadata, not wildcard matching or permission
  // to accept a file that the strict runtime integrity validator rejected.
  public static string InspectLiteralFile(string path) {
    ValidateLiteralInspectionAncestors(path);
    FileData data;
    if (!GetFileAttributesExW(Extended(path), 0, out data)) {
      return "exists=false win32Error=" + Marshal.GetLastWin32Error();
    }
    if ((data.Attributes & Reparse) != 0) throw new IOException("Payload contains a reparse point: " + path);
    ulong size = ((ulong)data.SizeHigh << 32) | data.SizeLow;
    return "exists=true kind=" + ((data.Attributes & Directory) == 0 ? "file" : "directory") +
      " bytes=" + size.ToString(System.Globalization.CultureInfo.InvariantCulture);
  }
  public static void Remove(string path) {
    ValidateAncestors(path);
    string target = Extended(path);
    ValidateTree(target, true);
    if (Attributes(target, true) != Invalid) DeleteTree(target);
  }
  public static void Copy(string source, string destination, bool replaceDestination) {
    // Roots are normalized by the caller; never delete or copy overlapping trees.
    if (String.Equals(source, destination, StringComparison.OrdinalIgnoreCase) ||
        source.StartsWith(destination + @"\", StringComparison.OrdinalIgnoreCase) ||
        destination.StartsWith(source + @"\", StringComparison.OrdinalIgnoreCase)) {
      throw new IOException("Payload source and destination must not overlap.");
    }
    ValidateAncestors(source);
    ValidateAncestors(destination);
    string from = Extended(source), to = Extended(destination);
    ValidateTree(from, false);
    ValidateTree(to, true);
    if (replaceDestination && Attributes(to, true) != Invalid) DeleteTree(to);
    CopyTree(from, to);
  }
}
'@
}

function Copy-RecoveryPayloadTree([string]$Source, [string]$Destination, [bool]$ReplaceDestination = $false) {
  Assert-SafeInstallRoot $Source 'Automatic update payload source'
  Assert-SafeInstallRoot $Destination 'Automatic update payload destination'
  [KunInstallerPayloadCopy]::Copy((Normalize-FullPath $Source), (Normalize-FullPath $Destination), $ReplaceDestination)
}

function Remove-RecoveryPayloadTree([string]$PathValue) {
  Assert-SafeInstallRoot $PathValue 'Automatic update payload cleanup'
  [KunInstallerPayloadCopy]::Remove((Normalize-FullPath $PathValue))
}
