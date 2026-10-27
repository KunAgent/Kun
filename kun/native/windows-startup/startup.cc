#include <node_api.h>
#include <windows.h>
#include <string>
#include <vector>
#include <cstdio>

// Handles live in the calling process, never in a disposable lock helper.
struct Lock {
  HANDLE guard = INVALID_HANDLE_VALUE;
  HANDLE legacy = INVALID_HANDLE_VALUE;
  bool published = false;
  bool created = false;
  void close() {
    if (legacy != INVALID_HANDLE_VALUE) { CloseHandle(legacy); legacy = INVALID_HANDLE_VALUE; }
    if (guard != INVALID_HANDLE_VALUE) { CloseHandle(guard); guard = INVALID_HANDLE_VALUE; }
  }
  ~Lock() { close(); }
};

static napi_value undef(napi_env env) { napi_value v; napi_get_undefined(env, &v); return v; }
static napi_value string(napi_env env, const std::string& value) {
  napi_value v; napi_create_string_utf8(env, value.data(), value.size(), &v); return v;
}
static void set(napi_env env, napi_value object, const char* name, napi_value value) {
  napi_set_named_property(env, object, name, value);
}
static napi_value fail(napi_env env, DWORD code, const char* operation) {
  napi_value error, number;
  napi_create_error(env, nullptr, string(env, std::string(operation) + " failed (Windows error " + std::to_string(code) + ")"), &error);
  napi_create_uint32(env, code, &number);
  set(env, error, "win32Code", number);
  set(env, error, "code", string(env, code == ERROR_ACCESS_DENIED ? "EACCES" : "EIO"));
  napi_throw(env, error);
  return nullptr;
}
static bool wide(napi_env env, napi_value value, std::wstring& result) {
  size_t length;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::vector<char16_t> buffer(length + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) return false;
  result.assign(reinterpret_cast<wchar_t*>(buffer.data()), length);
  return result.find(L'\0') == std::wstring::npos;
}
static bool contention(DWORD code) {
  return code == ERROR_SHARING_VIOLATION || code == ERROR_LOCK_VIOLATION || code == ERROR_DELETE_PENDING;
}
static void finalize(napi_env, void* data, void*) { delete static_cast<Lock*>(data); }
static Lock* lockArg(napi_env env, napi_value value) {
  void* pointer = nullptr;
  if (napi_get_value_external(env, value, &pointer) != napi_ok || !pointer) {
    napi_throw_type_error(env, nullptr, "Invalid startup lock handle"); return nullptr;
  }
  auto lock = static_cast<Lock*>(pointer);
  if (lock->legacy == INVALID_HANDLE_VALUE) {
    napi_throw_error(env, nullptr, "Startup lock is closed"); return nullptr;
  }
  return lock;
}

static napi_value acquire(napi_env env, napi_callback_info info) {
  size_t count = 2; napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  std::wstring guardPath, legacyPath;
  if (count != 2 || !wide(env, args[0], guardPath) || !wide(env, args[1], legacyPath)) {
    napi_throw_type_error(env, nullptr, "Expected startup lock paths"); return nullptr;
  }
  Lock* lock = new Lock();
  // Never delete/replace the guard: its file identity is the lock namespace.
  lock->guard = CreateFileW(guardPath.c_str(), GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  DWORD error = GetLastError();
  if (lock->guard == INVALID_HANDLE_VALUE) {
    delete lock; return contention(error) ? undef(env) : fail(env, error, "Open startup guard");
  }
  BY_HANDLE_FILE_INFORMATION details;
  if (!GetFileInformationByHandle(lock->guard, &details) || (details.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    delete lock; return fail(env, ERROR_INVALID_DATA, "Validate startup guard");
  }
  OVERLAPPED overlapped = {};
  if (!LockFileEx(lock->guard, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped)) {
    error = GetLastError(); delete lock;
    return contention(error) ? undef(env) : fail(env, error, "Acquire startup guard");
  }
  // Old clients keep a writable wx handle throughout action(). Deny write and
  // delete sharing: this pins that same legacy file and defeats delayed unlink.
  lock->legacy = CreateFileW(legacyPath.c_str(), GENERIC_READ | GENERIC_WRITE | DELETE,
    FILE_SHARE_READ, nullptr, OPEN_ALWAYS, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  error = GetLastError();
  if (lock->legacy == INVALID_HANDLE_VALUE) {
    delete lock; return contention(error) ? undef(env) : fail(env, error, "Open legacy startup lock");
  }
  lock->created = error != ERROR_ALREADY_EXISTS;
  if (!GetFileInformationByHandle(lock->legacy, &details) || (details.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    delete lock; return fail(env, ERROR_INVALID_DATA, "Validate legacy startup lock");
  }
  LARGE_INTEGER size;
  if (!GetFileSizeEx(lock->legacy, &size) || size.QuadPart > 65536) {
    delete lock; return fail(env, ERROR_INVALID_DATA, "Read startup lock size");
  }
  std::string text(static_cast<size_t>(size.QuadPart), '\0');
  DWORD read = 0;
  if (!text.empty() && !ReadFile(lock->legacy, &text[0], static_cast<DWORD>(text.size()), &read, nullptr)) {
    error = GetLastError(); delete lock; return fail(env, error, "Read startup lock");
  }
  text.resize(read);
  napi_value result, handle, created;
  napi_create_object(env, &result);
  napi_create_external(env, lock, finalize, nullptr, &handle);
  napi_get_boolean(env, lock->created, &created);
  set(env, result, "handle", handle);
  set(env, result, "created", created);
  set(env, result, "text", string(env, text));
  return result;
}

static napi_value publish(napi_env env, napi_callback_info info) {
  size_t count = 2; napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 2) { napi_throw_type_error(env, nullptr, "Expected handle and owner"); return nullptr; }
  Lock* lock = lockArg(env, args[0]); if (!lock) return nullptr;
    size_t length;
  if (napi_get_value_string_utf8(env, args[1], nullptr, 0, &length) != napi_ok || length > 65536) {
    napi_throw_type_error(env, nullptr, "Invalid startup owner"); return nullptr;
  }
  std::vector<char> buffer(length + 1);
  napi_get_value_string_utf8(env, args[1], buffer.data(), buffer.size(), &length);
  LARGE_INTEGER zero = {}; DWORD written;
  if (!SetFilePointerEx(lock->legacy, zero, nullptr, FILE_BEGIN) ||
      !WriteFile(lock->legacy, buffer.data(), static_cast<DWORD>(length), &written, nullptr) ||
      written != length || !SetEndOfFile(lock->legacy) || !FlushFileBuffers(lock->legacy)) {
    return fail(env, GetLastError(), "Publish startup owner");
  }
  lock->published = true;
  return undef(env);
}

static napi_value release(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 1) { napi_throw_type_error(env, nullptr, "Expected handle"); return nullptr; }
  Lock* lock = lockArg(env, args[0]); if (!lock) return nullptr;
  DWORD error = ERROR_SUCCESS;
  if (lock->published || lock->created) {
    FILE_DISPOSITION_INFO disposition = {}; disposition.DeleteFile = TRUE;
    if (!SetFileInformationByHandle(lock->legacy, FileDispositionInfo, &disposition, sizeof(disposition))) error = GetLastError();
  }
  lock->close();
  return error == ERROR_SUCCESS ? undef(env) : fail(env, error, "Release startup lock");
}

static napi_value inspect(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1]; double pidValue;
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 1 || napi_get_value_double(env, args[0], &pidValue) != napi_ok ||
      !(pidValue >= 1 && pidValue <= MAXDWORD) || pidValue != static_cast<DWORD>(pidValue)) {
    napi_throw_type_error(env, nullptr, "Invalid process PID"); return nullptr;
  }
  napi_value result; napi_create_object(env, &result);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, static_cast<DWORD>(pidValue));
  if (!process) {
    set(env, result, "state", string(env, GetLastError() == ERROR_INVALID_PARAMETER ? "dead" : "unknown"));
    return result;
  }
  DWORD wait = WaitForSingleObject(process, 0);
  FILETIME birth, exit, kernel, user;
  bool times = GetProcessTimes(process, &birth, &exit, &kernel, &user) != 0;
  CloseHandle(process);
  if (wait == WAIT_OBJECT_0 || !times || wait != WAIT_TIMEOUT) {
    set(env, result, "state", string(env, wait == WAIT_OBJECT_0 ? "dead" : "unknown")); return result;
  }
  ULARGE_INTEGER ticks; ticks.LowPart = birth.dwLowDateTime; ticks.HighPart = birth.dwHighDateTime;
  // Match historical .NET/CIM win32-v1 identity: microseconds, seven digits.
  ticks.QuadPart -= ticks.QuadPart % 10;
  birth.dwLowDateTime = ticks.LowPart; birth.dwHighDateTime = ticks.HighPart;
  SYSTEMTIME time;
  if (!FileTimeToSystemTime(&birth, &time)) {
    set(env, result, "state", string(env, "unknown")); return result;
  }
  char iso[64];
  std::snprintf(iso, sizeof(iso), "%04u-%02u-%02uT%02u:%02u:%02u.%07luZ",
    time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond,
    static_cast<unsigned long>(ticks.QuadPart % 10000000));
  napi_value milliseconds;
  napi_create_double(env, (static_cast<double>(ticks.QuadPart) - 116444736000000000.0) / 10000.0, &milliseconds);
  set(env, result, "state", string(env, "alive"));
  set(env, result, "identity", string(env, std::string("win32-v1:") + iso));
  set(env, result, "startedAtMs", milliseconds);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"acquire", nullptr, acquire, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"publish", nullptr, publish, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"release", nullptr, release, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspectProcess", nullptr, inspect, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
