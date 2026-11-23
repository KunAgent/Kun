package main

import (
	"strconv"
	"strings"
	"time"
)

const maxPrivacyLease = 6 * time.Second

type privacyRequest struct {
	show    bool
	expires time.Duration // monotonic time since this helper started
}

func parsePrivacyRequest(line string, received time.Duration) (privacyRequest, bool) {
	if line == "show" {
		return privacyRequest{show: true}, true
	}
	raw, ok := strings.CutPrefix(line, "lease ")
	if !ok {
		return privacyRequest{}, false
	}
	ms, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || ms > uint64(maxPrivacyLease/time.Millisecond) {
		return privacyRequest{}, false
	}
	return privacyRequest{expires: received + time.Duration(ms)*time.Millisecond}, true
}
