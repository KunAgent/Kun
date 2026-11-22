package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"syscall"
	"time"
)

type session struct {
	renderer          syscall.Handle
	bounds            geometry
	keys              map[string]bool
	buttons           map[int]bool
	until             time.Time
	configured, setup bool
}
type command struct {
	ID           int
	Operation    string
	CapturePid   int
	CaptureBirth string
	Bounds       geometry
	RemainingMs  int
	Event        inputEvent
}

func functionKey(i int) string { return "F" + strconv.Itoa(i) }
func (s *session) command(c command) string {
	switch c.Operation {
	case "configure":
		if !defaultDesktop() {
			return "DESKTOP_HOST_INACTIVE"
		}
		if s.configured || !c.Bounds.valid() {
			return "DESKTOP_SOURCE_CHANGED"
		}
		h, err := captureHandle(c.CapturePid, c.CaptureBirth)
		if err != nil {
			return "DESKTOP_CAPTURE_NOT_ISOLATED"
		}
		s.renderer = h
		s.bounds = c.Bounds
		s.configured = true
	case "setupLease", "lease":
		max := 6000
		if c.Operation == "setupLease" {
			if !s.setup {
				return "DESKTOP_SESSION_EXPIRED"
			}
			max = 15000
		} else {
			s.setup = false
		}
		if !s.configured || c.RemainingMs <= 0 || c.RemainingMs > max {
			return "DESKTOP_SESSION_EXPIRED"
		}
		next := time.Now().Add(time.Duration(c.RemainingMs) * time.Millisecond)
		if c.Operation == "lease" || next.Before(s.until) {
			s.until = next
		}
	case "ready":
		if !s.configured {
			return "DESKTOP_SESSION_EXPIRED"
		}
		if !defaultDesktop() {
			return "DESKTOP_HOST_INACTIVE"
		}
	case "input":
		if !s.configured || time.Now().After(s.until) || !s.input(c.Event) {
			return "DESKTOP_INPUT_FAILED"
		}
	case "release", "stop":
		if !s.release() {
			return "DESKTOP_CLEANUP_UNCONFIRMED"
		}
	default:
		return "INVALID_REQUEST"
	}
	return ""
}
func run() int {
	s := session{keys: map[string]bool{}, buttons: map[int]bool{}, setup: true, until: time.Now().Add(15 * time.Second)}
	args := os.Args[1:]
	proc := user32.NewProc("SetProcessDpiAwarenessContext")
	if proc.Find() == nil {
		proc.Call(^uintptr(3))
	} // per-monitor V2
	if len(args) > 0 {
		switch args[0] {
		case "--identity", "--terminate":
			if len(args) < 2 {
				return 2
			}
			pid, err := strconv.Atoi(args[1])
			if err != nil || pid <= 1 {
				return 2
			}
			if args[0] == "--identity" && len(args) == 2 {
				stamp, err := identity(pid)
				if err != nil {
					return 2
				}
				fmt.Println(stamp)
				return 0
			}
			if args[0] != "--terminate" || len(args) != 3 {
				return 2
			}
			h, err := captureHandle(pid, args[2])
			if errors.Is(err, syscall.Errno(87)) {
				return 0
			} // already exited
			if err != nil {
				return 2
			}
			defer syscall.CloseHandle(h)
			if !stopRenderer(h) {
				return 3
			}
			return 0
		case "--release-only":
			var payload struct {
				Keys    []string
				Buttons []int
			}
			line := bufio.NewScanner(os.Stdin)
			if !line.Scan() || len(line.Bytes()) > 8192 || json.Unmarshal(line.Bytes(), &payload) != nil || len(payload.Keys) > 64 || len(payload.Buttons) > 3 {
				return 2
			}
			for _, code := range payload.Keys {
				if _, ok := keys[code]; !ok {
					return 2
				}
				s.keys[code] = true
			}
			for _, which := range payload.Buttons {
				if which < 0 || which > 2 {
					return 2
				}
				s.buttons[which] = true
			}
			if !s.release() {
				return 3
			}
			return 0
		default:
			return 2
		}
	}
	commands := make(chan command)
	go func() {
		defer close(commands)
		lines := bufio.NewScanner(os.Stdin)
		lines.Buffer(make([]byte, 4096), 16384)
		for lines.Scan() {
			var c command
			if json.Unmarshal(lines.Bytes(), &c) != nil {
				return
			}
			commands <- c
		}
	}()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	defer func() {
		s.release()
		if s.renderer != 0 {
			stopRenderer(s.renderer)
			syscall.CloseHandle(s.renderer)
		}
	}()
	for {
		select {
		case <-ticker.C:
			if time.Now().After(s.until) || s.configured && !defaultDesktop() {
				return 3
			}
		case c, ok := <-commands:
			if !ok || time.Now().After(s.until) {
				return 3
			}
			message := s.command(c)
			response := map[string]any{"id": c.ID, "ok": message == ""}
			if message != "" {
				response["error"] = message
			}
			if json.NewEncoder(os.Stdout).Encode(response) != nil {
				return 3
			}
			if message == "" && c.Operation == "stop" {
				syscall.CloseHandle(s.renderer)
				s.renderer = 0
				return 0
			}
		}
	}
}
func main() { os.Exit(run()) }
