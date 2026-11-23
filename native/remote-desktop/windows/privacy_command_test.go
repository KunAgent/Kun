package main

import (
	"testing"
	"time"
)

func TestPrivacyPipeCommands(t *testing.T) {
	received := 3 * time.Second
	if request, ok := parsePrivacyRequest("show", received); !ok || !request.show {
		t.Fatal("show was not recognized")
	}
	for _, test := range []struct {
		line   string
		expiry time.Duration
	}{
		{"lease 6000", 9 * time.Second}, {"lease 125", received + 125*time.Millisecond}, {"lease 0", received},
	} {
		request, ok := parsePrivacyRequest(test.line, received)
		if !ok || request.show || request.expires != test.expiry {
			t.Errorf("%q: got %#v, valid=%t", test.line, request, ok)
		}
	}
	for _, line := range []string{"", "show 1", "lease", "lease -1", "lease 6001", "lease 1\nshow", "lease 10 100", "frame"} {
		if _, ok := parsePrivacyRequest(line, received); ok {
			t.Errorf("accepted %q", line)
		}
	}
}
