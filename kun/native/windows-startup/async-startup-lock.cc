#include <node_api.h>
#include <windows.h>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// No handle is inheritable. The caller owns both locks; no helper lifetime can
// release exclusion while its JavaScript critical section is still executing.
struct StartLock {
  HANDLE guard = INVALID_HANDLE_VALUE;
  HANDLE legacy = INVALID_HANDLE_VALUE;
  bool busy = false;
  void close() {
    if (legacy != INVALID_HANDLE_VALUE) { CloseHandle(legacy); legacy = INVALID_HANDLE_VALUE; }
    if (guard != INVALID_HANDLE_VALUE) { CloseHandle(guard); guard = INVALID_HANDLE_VALUE; }
  }
  ~StartLock() { close(); }
};

static napi_value String(napi_env env, const std::string& text) {
  napi_value value;
  napi_create_string_utf8(env, text.c_str(), text.size(), &value);
  return value;
}
static napi_value Error(napi_env env, DWORD code) {
  const char* name = code == ERROR_ACCESS_DENIED ? "EACCES" :
    code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND ? "ENOENT" :
    code == ERROR_INVALID_PARAMETER ? "ESRCH" : "EIO";
  napi_value error;
  napi_create_error(env, String(env, name), String(env, "Windows startup API failed"), &error);
  napi_value number;
  napi_create_uint32(env, code, &number);
  napi_set_named_property(env, error, "win32Error", number);
  return error;
}
static bool GetString(napi_env env, napi_value value, std::string& text) {
  size_t size;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size > 65536) return false;
  std::vector<char> buffer(size + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &size) != napi_ok) return false;
  text.assign(buffer.data(), size);
  return true;
}
static bool GetPath(napi_env env, napi_value value, std::wstring& path) {
  size_t size;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &size) != napi_ok || !size || size > 32760) return false;
  std::vector<char16_t> buffer(size + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &size) != napi_ok) return false;
  path.assign(reinterpret_cast<wchar_t*>(buffer.data()), size);
  return path.find(L'\0') == std::wstring::npos;
}

enum Operation { Acquire, Write, Release };
struct Work {
  napi_env env;
  napi_deferred deferred;
  napi_async_work work = nullptr;
  napi_ref reference = nullptr;
  Operation operation;
  StartLock* lock = nullptr;
  std::wstring path;
  std::string text;
  DWORD error = 0;
  bool created = false;
  bool remove = false;
  bool contention = false;
};
static bool Contention(DWORD code) {
  return code == ERROR_SHARING_VIOLATION || code == ERROR_LOCK_VIOLATION || code == ERROR_DELETE_PENDING;
}
static DWORD ValidateLockFile(HANDLE handle) {
  BY_HANDLE_FILE_INFORMATION details;
  if (!GetFileInformationByHandle(handle, &details)) return GetLastError();
  // Profile directory junctions are supported, but a lock leaf must never
  // redirect metadata writes/deletion into history, settings, or another file.
  if ((details.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) ||
      details.nNumberOfLinks != 1) return ERROR_ACCESS_DENIED;
  return 0;
}
static void AcquireLock(Work* work) {
  work->lock = new StartLock();
  auto* lock = work->lock;
  // Never delete or replace the guard inode. Deny delete sharing while open.
  lock->guard = CreateFileW((work->path + L".guard").c_str(), GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (lock->guard == INVALID_HANDLE_VALUE) { work->error = GetLastError(); return; }
  work->error = ValidateLockFile(lock->guard);
  if (work->error) return;
  OVERLAPPED position = {};
  if (!LockFileEx(lock->guard, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &position)) {
    work->error = GetLastError(); return;
  }
  // The old wx protocol holds a write handle for its entire action. Refusing
  // share-write excludes it, and refusing share-delete defeats old reclaimers'
  // delayed unlink. Keep this handle until AFTER our action completes.
  lock->legacy = CreateFileW(work->path.c_str(), GENERIC_READ | GENERIC_WRITE | DELETE,
    FILE_SHARE_READ, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  DWORD opened = GetLastError();
  if (lock->legacy == INVALID_HANDLE_VALUE) { work->error = opened; return; }
  work->error = ValidateLockFile(lock->legacy);
  if (work->error) return;
  work->created = opened != ERROR_ALREADY_EXISTS;
  LARGE_INTEGER size;
  if (!GetFileSizeEx(lock->legacy, &size)) { work->error = GetLastError(); return; }
  if (size.QuadPart > 65536) { work->error = ERROR_FILE_TOO_LARGE; return; }
  work->text.resize(static_cast<size_t>(size.QuadPart));
  DWORD read = 0;
  if (size.QuadPart && !ReadFile(lock->legacy, work->text.data(), static_cast<DWORD>(size.QuadPart), &read, nullptr)) {
    work->error = GetLastError(); return;
  }
  work->text.resize(read);
}
static void Execute(napi_env, void* data) {
  auto* work = static_cast<Work*>(data);
  if (work->operation == Acquire) {
    AcquireLock(work);
    if (work->error) {
      work->contention = Contention(work->error);
      delete work->lock; work->lock = nullptr;
    }
    return;
  }
  if (work->operation == Write) {
    LARGE_INTEGER offset = {};
    DWORD written;
    if (!SetFilePointerEx(work->lock->legacy, offset, nullptr, FILE_BEGIN) ||
        !WriteFile(work->lock->legacy, work->text.data(), static_cast<DWORD>(work->text.size()), &written, nullptr) ||
        written != work->text.size() || !SetEndOfFile(work->lock->legacy) || !FlushFileBuffers(work->lock->legacy)) {
      work->error = GetLastError();
      if (!work->error) work->error = ERROR_WRITE_FAULT;
    }
    return;
  }
  if (work->remove && work->lock->legacy != INVALID_HANDLE_VALUE) {
    FILE_DISPOSITION_INFO disposition = { TRUE };
    // Atomic by-handle deletion, never a path-based compare/unlink.
    if (!SetFileInformationByHandle(work->lock->legacy, FileDispositionInfo, &disposition, sizeof(disposition))) {
      work->error = GetLastError();
    }
  }
  work->lock->close();
}
static void Finalize(napi_env, void* data, void*) { delete static_cast<StartLock*>(data); }
static void Complete(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<Work*>(data);
  napi_value result;
  if (work->operation != Acquire) work->lock->busy = false;
  if (status != napi_ok && !work->error) work->error = ERROR_OPERATION_ABORTED;
  if (work->error && !work->contention) {
    if (work->operation == Acquire && work->lock) delete work->lock;
    napi_reject_deferred(env, work->deferred, Error(env, work->error));
  } else {
    if (work->operation == Acquire && !work->contention) {
      napi_value handle, created;
      napi_create_object(env, &result);
      napi_create_external(env, work->lock, Finalize, nullptr, &handle);
      napi_get_boolean(env, work->created, &created);
      napi_set_named_property(env, result, "handle", handle);
      napi_set_named_property(env, result, "text", String(env, work->text));
      napi_set_named_property(env, result, "created", created);
    } else napi_get_null(env, &result);
    napi_resolve_deferred(env, work->deferred, result);
  }
  if (work->reference) napi_delete_reference(env, work->reference);
  napi_delete_async_work(env, work->work);
  delete work;
}
static napi_value Queue(napi_env env, napi_callback_info info, Operation operation) {
  size_t argc = 2;
  napi_value args[2], promise;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  auto* work = new Work(); work->env = env; work->operation = operation;
  bool valid = false;
  if (operation == Acquire) valid = argc >= 1 && GetPath(env, args[0], work->path);
  else {
    valid = argc == 2 && napi_get_value_external(env, args[0], reinterpret_cast<void**>(&work->lock)) == napi_ok;
    valid = valid && work->lock && !work->lock->busy && work->lock->legacy != INVALID_HANDLE_VALUE;
    if (valid) valid = operation == Write ? GetString(env, args[1], work->text)
      : napi_get_value_bool(env, args[1], &work->remove) == napi_ok;
    if (valid) {
      work->lock->busy = true;
      napi_create_reference(env, args[0], 1, &work->reference);
    }
  }
  if (!valid) { delete work; napi_throw_type_error(env, nullptr, "Invalid or busy startup lock"); return nullptr; }
  napi_create_promise(env, &work->deferred, &promise);
  napi_status status = napi_create_async_work(env, nullptr, String(env, "Kun Windows startup lock"), Execute, Complete, work, &work->work);
  if (status == napi_ok) status = napi_queue_async_work(env, work->work);
  if (status != napi_ok) {
    if (work->reference) { work->lock->busy = false; napi_delete_reference(env, work->reference); }
    napi_reject_deferred(env, work->deferred, Error(env, ERROR_NOT_ENOUGH_MEMORY));
    if (work->work) napi_delete_async_work(env, work->work);
    delete work;
  }
  return promise;
}
static napi_value AcquireStartLock(napi_env env, napi_callback_info info) { return Queue(env, info, Acquire); }
static napi_value WriteStartLock(napi_env env, napi_callback_info info) { return Queue(env, info, Write); }
static napi_value ReleaseStartLock(napi_env env, napi_callback_info info) { return Queue(env, info, Release); }
napi_value add_async_start_lock(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"acquireStartLock", nullptr, AcquireStartLock, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"writeStartLock", nullptr, WriteStartLock, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"releaseStartLock", nullptr, ReleaseStartLock, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 3, properties);
  return exports;
}
