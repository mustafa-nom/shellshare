package session

import (
	"fmt"
	"os"
	"strings"

	"github.com/shellshare/cli/internal/terminal"
	"github.com/shellshare/cli/internal/types"
)

// Menu represents the Ctrl+S command overlay
type Menu struct {
	session *Session
	visible bool
}

func NewMenu(s *Session) *Menu {
	return &Menu{session: s}
}

// Toggle shows/hides the menu
func (m *Menu) Toggle() {
	m.visible = !m.visible
	if m.visible {
		m.Draw()
	} else {
		m.Clear()
	}
}

// HandleKey processes a keypress while the menu is open.
// Returns true if the menu consumed the key.
func (m *Menu) HandleKey(key byte) bool {
	if !m.visible {
		return false
	}

	s := m.session
	switch key {
	case 'q': // Leave room
		m.visible = false
		return false // let the session exit
	case 'o': // Toggle visibility
		vis := "open"
		s.mu.Lock()
		if s.RoomState != nil && s.RoomState.Visibility == "open" {
			vis = "private"
		}
		s.mu.Unlock()
		s.Client.SendJSON(types.SetVisibilityMessage{
			Type:       "set_visibility",
			Visibility: vis,
		})
		m.Toggle()
	case 'x': // Lock/unlock
		s.mu.Lock()
		locked := s.RoomState != nil && s.RoomState.Locked
		s.mu.Unlock()
		cmd := "/lock"
		if locked {
			cmd = "/unlock"
		}
		s.Client.SendJSON(types.CommandMessage{Type: "command", Text: cmd})
		m.Toggle()
	case 'k': // Kick (admin only)
		// Would need user selection UI - simplified for now
		m.Toggle()
	case 27, 0x13: // Esc or Ctrl+S to close
		m.Toggle()
	}
	return true
}

// Draw renders the menu overlay
func (m *Menu) Draw() {
	cols, rows, err := terminal.GetSize()
	if err != nil {
		return
	}

	s := m.session
	s.mu.Lock()
	roomState := s.RoomState
	roomCode := s.RoomCode
	isAdmin := s.IsAdmin
	userID := s.UserID
	s.mu.Unlock()

	if roomState == nil {
		return
	}

	// Build menu lines
	var lines []string
	lines = append(lines, fmt.Sprintf("┌─ ShellShare: %s ─┐", roomCode))
	lines = append(lines, "│")

	// Users
	lines = append(lines, "│ Users:")
	for _, u := range roomState.Users {
		marker := "  "
		if u.ID == userID {
			marker = "→ "
		}
		admin := ""
		if u.IsAdmin {
			admin = " (admin)"
		}
		lines = append(lines, fmt.Sprintf("│ %s%s%s", marker, u.Name, admin))
	}
	lines = append(lines, "│")

	// Actions
	lines = append(lines, "│ Actions:")
	if isAdmin {
		lines = append(lines, "│  [o] Toggle public/private")
		lines = append(lines, "│  [x] Lock/unlock room")
		lines = append(lines, "│  [k] Kick user")
	}
	lines = append(lines, "│  [q] Leave room")
	lines = append(lines, "│  [Esc] Close menu")
	lines = append(lines, "│")

	// Find max width
	maxW := 0
	for _, l := range lines {
		stripped := stripAnsi(l)
		if len(stripped) > maxW {
			maxW = len(stripped)
		}
	}
	maxW += 2 // padding

	// Close border
	lines[0] = fmt.Sprintf("┌─ ShellShare: %s %s┐", roomCode, strings.Repeat("─", maxW-len(roomCode)-18))
	lines = append(lines, "└"+strings.Repeat("─", maxW-2)+"┘")

	// Calculate position (centered)
	startRow := (rows - len(lines)) / 2
	startCol := (cols - maxW) / 2
	if startRow < 1 {
		startRow = 1
	}
	if startCol < 1 {
		startCol = 1
	}

	// Save cursor and render
	fmt.Fprintf(os.Stdout, "\033[s")
	for i, line := range lines {
		stripped := stripAnsi(line)
		pad := maxW - len(stripped)
		if pad < 0 {
			pad = 0
		}
		// Position cursor, dark background
		fmt.Fprintf(os.Stdout, "\033[%d;%dH\033[48;5;237m\033[97m%s%s\033[0m",
			startRow+i, startCol, line, strings.Repeat(" ", pad))
	}
	fmt.Fprintf(os.Stdout, "\033[u")
}

// Clear removes the menu overlay by redrawing the area
func (m *Menu) Clear() {
	// The PTY output will naturally overwrite the area
	// Just force a status bar redraw
	m.session.redrawStatusBar()
}
