package session

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/shellshare/cli/internal/terminal"
	"github.com/shellshare/cli/internal/types"
)

// Chat manages the split-screen chat panel
type Chat struct {
	session     *Session
	visible     bool
	inputBuf    []byte
	messages    []chatMsg
	maxMessages int
}

type chatMsg struct {
	userName  string
	userColor string
	text      string
	isSystem  bool
	timestamp time.Time
}

func NewChat(s *Session) *Chat {
	return &Chat{
		session:     s,
		maxMessages: 100,
	}
}

// Toggle shows/hides the chat panel
func (c *Chat) Toggle() {
	c.visible = !c.visible
	cols, rows, _ := terminal.GetSize()
	if c.visible {
		c.Draw(cols, rows)
	} else {
		// Reset scroll region to full terminal (minus status bar)
		fmt.Fprintf(os.Stdout, "\033[1;%dr", rows-1)
		// Clear the chat area
		chatHeight := c.height(rows)
		for i := rows - chatHeight; i < rows; i++ {
			fmt.Fprintf(os.Stdout, "\033[%d;1H\033[K", i)
		}
		// Redraw status bar
		c.session.redrawStatusBar()
	}
}

// AddChatMessage adds a received message to the chat
func (c *Chat) AddChatMessage(msg *types.ChatMessagePayload) {
	cm := chatMsg{
		userName:  msg.UserName,
		userColor: msg.Color,
		text:      msg.Text,
		isSystem:  msg.Type == "system",
		timestamp: time.Now(),
	}
	c.messages = append(c.messages, cm)
	if len(c.messages) > c.maxMessages {
		c.messages = c.messages[1:]
	}
	if c.visible {
		cols, rows, _ := terminal.GetSize()
		c.Draw(cols, rows)
	}
}

// HandleKey processes input while chat is visible.
// Returns true if the key was consumed.
func (c *Chat) HandleKey(data []byte) bool {
	if !c.visible {
		return false
	}

	for _, b := range data {
		switch b {
		case 13: // Enter
			c.sendInput()
		case 127, 8: // Backspace
			if len(c.inputBuf) > 0 {
				c.inputBuf = c.inputBuf[:len(c.inputBuf)-1]
			}
		case 27: // Esc
			c.Toggle()
			return true
		default:
			if b >= 32 { // Printable
				c.inputBuf = append(c.inputBuf, b)
			}
		}
	}

	cols, rows, _ := terminal.GetSize()
	c.drawInputLine(cols, rows)
	return true
}

func (c *Chat) sendInput() {
	text := strings.TrimSpace(string(c.inputBuf))
	c.inputBuf = c.inputBuf[:0]

	if text == "" {
		return
	}

	// Check for commands
	if strings.HasPrefix(text, "/") {
		c.session.Client.SendJSON(types.CommandMessage{
			Type: "command",
			Text: text,
		})
	} else {
		c.session.Client.SendJSON(types.ChatMessage{
			Type: "chat",
			Text: text,
		})
	}
}

func (c *Chat) height(termRows int) int {
	h := termRows * 30 / 100 // Default 30%
	if h < 5 {
		h = 5
	}
	return h
}

// Draw renders the chat panel
func (c *Chat) Draw(cols, rows int) {
	chatH := c.height(rows)
	ptyRows := rows - chatH - 1 // -1 for status bar

	// Set scroll region for PTY output (top area)
	fmt.Fprintf(os.Stdout, "\033[1;%dr", ptyRows)

	// Save cursor
	fmt.Fprintf(os.Stdout, "\033[s")

	// Draw separator line
	sepRow := ptyRows + 1
	fmt.Fprintf(os.Stdout, "\033[%d;1H\033[48;5;236m\033[97m%s\033[0m",
		sepRow, strings.Repeat("─", cols))

	// Draw messages
	msgStart := sepRow + 1
	msgEnd := rows - 2 // Leave room for input line and status bar
	msgArea := msgEnd - msgStart + 1

	// Get visible messages
	start := 0
	if len(c.messages) > msgArea {
		start = len(c.messages) - msgArea
	}
	visibleMsgs := c.messages[start:]

	for i := 0; i < msgArea; i++ {
		row := msgStart + i
		fmt.Fprintf(os.Stdout, "\033[%d;1H\033[K", row) // Clear line
		if i < len(visibleMsgs) {
			msg := visibleMsgs[i]
			if msg.isSystem {
				fmt.Fprintf(os.Stdout, "\033[90m  * %s\033[0m", truncate(msg.text, cols-4))
			} else {
				fmt.Fprintf(os.Stdout, "  \033[1m%s:\033[0m %s",
					msg.userName, truncate(msg.text, cols-len(msg.userName)-5))
			}
		}
	}

	// Draw input line
	c.drawInputLine(cols, rows)

	// Restore cursor
	fmt.Fprintf(os.Stdout, "\033[u")
}

func (c *Chat) drawInputLine(cols, rows int) {
	inputRow := rows - 1 // Above status bar
	fmt.Fprintf(os.Stdout, "\033[s") // Save
	fmt.Fprintf(os.Stdout, "\033[%d;1H\033[K", inputRow)
	prompt := "[chat] › "
	input := string(c.inputBuf)
	maxInput := cols - len(prompt) - 1
	if len(input) > maxInput {
		input = input[len(input)-maxInput:]
	}
	fmt.Fprintf(os.Stdout, "\033[36m%s\033[0m%s", prompt, input)
	fmt.Fprintf(os.Stdout, "\033[u") // Restore
}

func truncate(s string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-1] + "…"
}

// Notification represents a transient chat notification in shell mode
type Notification struct {
	userName string
	text     string
	expires  time.Time
}

// ShowNotification displays a brief popup notification
func (s *Session) drawNotification(userName, text string) {
	cols, _, _ := terminal.GetSize()
	msg := fmt.Sprintf("%s: %s", userName, text)
	if len(msg) > 40 {
		msg = msg[:37] + "..."
	}

	// Draw in top-right corner
	col := cols - len(msg) - 4
	if col < 1 {
		col = 1
	}

	fmt.Fprintf(os.Stdout, "\033[s") // Save cursor
	fmt.Fprintf(os.Stdout, "\033[1;%dH\033[48;5;24m\033[97m %s \033[0m", col, msg)
	fmt.Fprintf(os.Stdout, "\033[u") // Restore cursor

	// Auto-clear after 3 seconds
	go func() {
		time.Sleep(3 * time.Second)
		fmt.Fprintf(os.Stdout, "\033[s")
		fmt.Fprintf(os.Stdout, "\033[1;%dH%s", col, strings.Repeat(" ", len(msg)+2))
		fmt.Fprintf(os.Stdout, "\033[u")
	}()
}
