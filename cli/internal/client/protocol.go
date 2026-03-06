package client

import (
	"fmt"
)

const (
	PtyOutputType byte = 0x01
)

// PtyFrame represents a parsed binary PTY output frame
type PtyFrame struct {
	TerminalID string
	Data       []byte
}

// ParsePtyFrame parses a binary PTY output frame.
// Format: [0x01][terminalId length (1 byte)][terminalId (N bytes)][data]
func ParsePtyFrame(data []byte) (*PtyFrame, error) {
	if len(data) < 3 {
		return nil, fmt.Errorf("frame too short: %d bytes", len(data))
	}
	if data[0] != PtyOutputType {
		return nil, fmt.Errorf("unknown frame type: 0x%02x", data[0])
	}

	tidLen := int(data[1])
	if len(data) < 2+tidLen {
		return nil, fmt.Errorf("frame truncated: need %d bytes for terminal ID, have %d", tidLen, len(data)-2)
	}

	terminalID := string(data[2 : 2+tidLen])
	payload := data[2+tidLen:]

	return &PtyFrame{
		TerminalID: terminalID,
		Data:       payload,
	}, nil
}
