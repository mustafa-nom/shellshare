package session

import (
	"fmt"
	"os"
	"strings"
)

// StatusBar renders a single-line status bar at the bottom of the terminal.
type StatusBar struct {
	session *Session
	visible bool
}

func NewStatusBar(s *Session) *StatusBar {
	return &StatusBar{session: s, visible: true}
}

// Draw renders the status bar at the bottom of the terminal.
func (sb *StatusBar) Draw(cols, rows int) {
	if !sb.visible {
		// Reset scroll region to full terminal
		fmt.Fprintf(os.Stdout, "\033[1;%dr", rows)
		return
	}

	s := sb.session
	s.mu.Lock()
	roomState := s.RoomState
	userID := s.UserID
	isAdmin := s.IsAdmin
	roomCode := s.RoomCode
	role := s.Role
	s.mu.Unlock()

	if roomState == nil {
		return
	}

	// Set scroll region to exclude bottom line
	fmt.Fprintf(os.Stdout, "\033[1;%dr", rows-1)

	// Save cursor position
	fmt.Fprintf(os.Stdout, "\033[s")

	// Move to the status bar line
	fmt.Fprintf(os.Stdout, "\033[%d;1H", rows)

	// Build status bar content
	var parts []string

	// Room code with green dot
	parts = append(parts, fmt.Sprintf("\033[32m●\033[0m %s", roomCode))

	// Current user info
	for _, u := range roomState.Users {
		if u.ID == userID {
			roleStr := ""
			if isAdmin {
				roleStr = ", admin"
			}
			if role == "driver" {
				roleStr += ", DRIVER"
			} else if role == "spectator" {
				roleStr += ", SPECTATING"
			}
			parts = append(parts, fmt.Sprintf("%s (you%s)", u.Name, roleStr))
			break
		}
	}

	// Other users
	var others []string
	for _, u := range roomState.Users {
		if u.ID != userID {
			others = append(others, u.Name)
		}
	}
	if len(others) > 0 {
		parts = append(parts, strings.Join(others, ", "))
	}

	// Online count
	parts = append(parts, fmt.Sprintf("%d online", len(roomState.Users)))

	// Help hint
	parts = append(parts, "Ctrl+S: menu")

	content := strings.Join(parts, " │ ")

	// Truncate if too long
	if len(content) > cols {
		content = content[:cols-1] + "…"
	}

	// Pad to full width with dark gray background
	padding := cols - len(stripAnsi(content))
	if padding < 0 {
		padding = 0
	}

	// Dark gray background, white text
	fmt.Fprintf(os.Stdout, "\033[48;5;236m\033[97m %s%s\033[0m", content, strings.Repeat(" ", padding))

	// Restore cursor position
	fmt.Fprintf(os.Stdout, "\033[u")
}

// stripAnsi removes ANSI escape codes for length calculation
func stripAnsi(s string) string {
	result := make([]byte, 0, len(s))
	inEsc := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\033' {
			inEsc = true
			continue
		}
		if inEsc {
			if (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') {
				inEsc = false
			}
			continue
		}
		result = append(result, s[i])
	}
	return string(result)
}
