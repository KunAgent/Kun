package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

const queryProcess = 0x1000
const synchronize = 0x100000
const terminateProcess = 1

// Hold the kernel handle while checking creation time and terminating a renderer.
// A recycled PID cannot redirect a cleanup operation to another process.
func birth(handle syscall.Handle) (string, error) {
	var created, exited, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d", created.HighDateTime, created.LowDateTime), nil
}
func identity(pid int) (string, error) {
	if pid <= 1 {
		return "", errors.New("invalid process")
	}
	h, err := syscall.OpenProcess(queryProcess, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer syscall.CloseHandle(h)
	return birth(h)
}
func descendant(pid int, parent int) bool {
	if pid <= 1 || pid == parent || pid == os.Getpid() {
		return false
	}
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(snapshot)
	var entry syscall.ProcessEntry32
	entry.Size = uint32(processEntrySize())
	parents := make(map[int]int)
	for err = syscall.Process32First(snapshot, &entry); err == nil; err = syscall.Process32Next(snapshot, &entry) {
		parents[int(entry.ProcessID)] = int(entry.ParentProcessID)
	}
	for depth := 0; depth < 12 && pid > 1; depth++ {
		pid = parents[pid]
		if pid == parent {
			return true
		}
	}
	return false
}
func captureHandle(pid int, stamp string) (syscall.Handle, error) {
	h, err := syscall.OpenProcess(queryProcess|synchronize|terminateProcess, false, uint32(pid))
	if err != nil {
		return 0, err
	}
	actual, err := birth(h)
	if err != nil || stamp == "" || stamp != actual || !descendant(pid, os.Getppid()) {
		syscall.CloseHandle(h)
		return 0, errors.New("renderer identity mismatch")
	}
	return h, nil
}
func stopRenderer(h syscall.Handle) bool {
	if h == 0 {
		return true
	}
	if result, _ := syscall.WaitForSingleObject(h, 0); result == syscall.WAIT_OBJECT_0 {
		return true
	}
	if syscall.TerminateProcess(h, 0) != nil {
		return false
	}
	result, err := syscall.WaitForSingleObject(h, 1000)
	return err == nil && result == syscall.WAIT_OBJECT_0
}
