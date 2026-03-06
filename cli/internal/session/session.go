package session

import (
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/shellshare/cli/internal/client"
	"github.com/shellshare/cli/internal/config"
	"github.com/shellshare/cli/internal/terminal"
	"github.com/shellshare/cli/internal/types"
)

// Session manages a connected ShellShare room session
type Session struct {
	Client     *client.Client
	ServerURL  string
	UserName   string
	RoomCode   string
	UserID     string
	TerminalID string
	RoomState  *types.RoomState
	IsAdmin    bool
	Role       string // "driver" or "spectator" (Claude Code mode)

	mu            sync.Mutex
	restoreRaw    func()
	stopResize    func()
	statusBar     *StatusBar
	menu          *Menu
	chat          *Chat
	lastCtrlC     int64 // unix nano timestamp of last Ctrl+C
	notifications []notification
	roomStateCh   chan *types.RoomState
	roomErrCh     chan error
}

type notification struct {
	text    string
	color   string
	expires int64
}

// Options for starting a session
type Options struct {
	Mode    string // "normal" or "claude-code"
	APIKey  string
	Project string
}

// Start connects to the server, joins the room, and enters the terminal loop.
func Start(serverURL, roomCode, userName string, opts ...Options) error {
	var opt Options
	if len(opts) > 0 {
		opt = opts[0]
	}

	s := &Session{
		ServerURL: serverURL,
		UserName:  userName,
	}

	// Create WS client with handlers
	wsClient := client.New(serverURL, client.Handler{
		OnPtyOutput:  s.handlePtyOutput,
		OnMessage:    s.handleMessage,
		OnDisconnect: s.handleDisconnect,
	})
	s.Client = wsClient

	// Connect
	fmt.Fprintf(os.Stderr, "Connecting to %s...\n", serverURL)
	if err := wsClient.ConnectWithRetry(); err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	// Send join message
	joinMsg := types.JoinMessage{
		Type:     "join",
		RoomCode: roomCode,
		UserName: userName,
		Mode:     opt.Mode,
		APIKey:   opt.APIKey,
	}
	if err := wsClient.SendJSON(joinMsg); err != nil {
		wsClient.Close()
		return fmt.Errorf("sending join: %w", err)
	}

	// Wait for room_state
	roomState, err := s.waitForRoomState()
	if err != nil {
		wsClient.Close()
		return err
	}

	s.mu.Lock()
	s.RoomState = roomState
	s.UserID = roomState.UserID
	s.RoomCode = roomState.Code
	s.IsAdmin = roomState.AdminID == roomState.UserID
	if len(roomState.Terminals) > 0 {
		s.TerminalID = roomState.Terminals[0].ID
	}
	// Set initial role from room state
	for _, u := range roomState.Users {
		if u.ID == roomState.UserID {
			s.Role = u.Role
			break
		}
	}
	s.mu.Unlock()

	// Save to history
	config.AddToHistory(s.RoomCode, serverURL, userName)

	// Get terminal size
	cols, rows, err := terminal.GetSize()
	if err != nil {
		wsClient.Close()
		return fmt.Errorf("getting terminal size: %w", err)
	}

	// Send initial resize (triggers PTY spawn on server)
	if err := wsClient.SendJSON(types.ResizeMessage{
		Type:       "resize",
		TerminalID: s.TerminalID,
		Cols:       cols,
		Rows:       rows,
	}); err != nil {
		wsClient.Close()
		return fmt.Errorf("sending resize: %w", err)
	}

	// Print welcome banner
	s.printBanner(cols)

	// Enter raw mode
	restoreRaw, err := terminal.RawMode()
	if err != nil {
		wsClient.Close()
		return fmt.Errorf("entering raw mode: %w", err)
	}
	s.restoreRaw = restoreRaw

	// Set up status bar, menu, and chat
	s.statusBar = NewStatusBar(s)
	s.menu = NewMenu(s)
	s.chat = NewChat(s)
	s.statusBar.Draw(cols, rows)

	// Watch for resize
	s.stopResize = terminal.WatchResize(func(c, r int) {
		wsClient.SendJSON(types.ResizeMessage{
			Type:       "resize",
			TerminalID: s.TerminalID,
			Cols:       c,
			Rows:       r,
		})
		s.statusBar.Draw(c, r)
	})

	// Handle SIGINT/SIGTERM for clean shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		select {
		case <-sigCh:
			s.cleanup()
			os.Exit(0)
		case <-wsClient.Done():
		}
	}()

	// Start stdin read loop (blocking)
	s.readStdin()

	s.cleanup()
	return nil
}

func (s *Session) cleanup() {
	if s.stopResize != nil {
		s.stopResize()
	}
	_, rows, _ := terminal.GetSize()
	terminal.FullRestore(s.restoreRaw, rows)
	s.Client.Close()
}

func (s *Session) printBanner(cols int) {
	fmt.Fprintf(os.Stderr, "\033[1;36m") // Bold cyan
	fmt.Fprintf(os.Stderr, "  ShellShare Room: %s\n", s.RoomCode)
	fmt.Fprintf(os.Stderr, "  Share: http://localhost:3000/%s\n", s.RoomCode)
	fmt.Fprintf(os.Stderr, "  Ctrl+S: menu │ Ctrl+Q: quit\n")
	fmt.Fprintf(os.Stderr, "\033[0m")
}

func (s *Session) waitForRoomState() (*types.RoomState, error) {
	stateCh := make(chan *types.RoomState, 1)
	errCh := make(chan error, 1)

	// Temporarily override message handler
	origHandler := s.Client
	_ = origHandler

	// We need a channel-based approach since the handler is already set
	// The handler will be called by the read loop
	s.mu.Lock()
	s.roomStateCh = stateCh
	s.roomErrCh = errCh
	s.mu.Unlock()

	select {
	case state := <-stateCh:
		s.mu.Lock()
		s.roomStateCh = nil
		s.roomErrCh = nil
		s.mu.Unlock()
		return state, nil
	case err := <-errCh:
		return nil, err
	}
}

func (s *Session) handlePtyOutput(terminalID string, data []byte) {
	s.mu.Lock()
	if s.TerminalID == "" || terminalID == s.TerminalID {
		os.Stdout.Write(data)
	}
	s.mu.Unlock()
}

func (s *Session) handleMessage(msg types.ServerMessage) {
	s.mu.Lock()
	stateCh := s.roomStateCh
	errCh := s.roomErrCh
	s.mu.Unlock()

	switch msg.Type {
	case "room_state":
		if msg.Room == nil {
			return
		}
		state := &types.RoomState{
			Code:       msg.Room.Code,
			Locked:     msg.Room.Locked,
			Visibility: msg.Room.Visibility,
			Mode:       msg.Room.Mode,
			AdminID:    msg.Room.AdminID,
			DriverID:   msg.Room.DriverID,
			Users:      msg.Room.Users,
			Messages:   msg.Room.Messages,
			Terminals:  msg.Room.Terminals,
			UserID:     msg.UserID,
		}
		if stateCh != nil {
			stateCh <- state
		} else {
			s.mu.Lock()
			s.RoomState = state
			s.IsAdmin = msg.AdminID == s.UserID
			s.mu.Unlock()
			s.redrawStatusBar()
		}

	case "error":
		if errCh != nil {
			errCh <- fmt.Errorf("server error: %s", msg.Message)
		}

	case "user_joined":
		if msg.User != nil {
			s.mu.Lock()
			if s.RoomState != nil {
				s.RoomState.Users = append(s.RoomState.Users, *msg.User)
			}
			s.mu.Unlock()
			s.redrawStatusBar()
		}

	case "user_left":
		if msg.User != nil {
			s.mu.Lock()
			if s.RoomState != nil {
				users := make([]types.UserInfo, 0, len(s.RoomState.Users))
				for _, u := range s.RoomState.Users {
					if u.ID != msg.User.ID {
						users = append(users, u)
					}
				}
				s.RoomState.Users = users
			}
			if msg.AdminID != "" {
				s.RoomState.AdminID = msg.AdminID
				s.IsAdmin = msg.AdminID == s.UserID
			}
			s.mu.Unlock()
			s.redrawStatusBar()
		}

	case "kicked":
		s.cleanup()
		fmt.Fprintf(os.Stderr, "\nYou were kicked from the room.\n")
		os.Exit(1)

	case "chat_message":
		if s.chat != nil && msg.ChatMsg != nil {
			s.chat.AddChatMessage(msg.ChatMsg)
		}
		if s.chat != nil && !s.chat.visible && msg.ChatMsg != nil && msg.ChatMsg.UserID != s.UserID && msg.ChatMsg.Type != "system" {
			s.drawNotification(msg.ChatMsg.UserName, msg.ChatMsg.Text)
		}

	case "terminal_created":
		if msg.Terminal != nil {
			s.mu.Lock()
			if s.RoomState != nil {
				s.RoomState.Terminals = append(s.RoomState.Terminals, *msg.Terminal)
			}
			s.mu.Unlock()
		}

	case "terminal_closed":
		s.mu.Lock()
		if s.RoomState != nil {
			tabs := make([]types.TerminalTab, 0)
			for _, t := range s.RoomState.Terminals {
				if t.ID != msg.TerminalID {
					tabs = append(tabs, t)
				}
			}
			s.RoomState.Terminals = tabs
			// If our active terminal was closed, switch to first available
			if s.TerminalID == msg.TerminalID && len(tabs) > 0 {
				s.TerminalID = tabs[0].ID
			}
		}
		s.mu.Unlock()

	case "role_changed":
		s.mu.Lock()
		if msg.UserID == s.UserID {
			s.Role = msg.Role
		}
		// Update user in room state
		if s.RoomState != nil {
			for i, u := range s.RoomState.Users {
				if u.ID == msg.UserID {
					s.RoomState.Users[i].Role = msg.Role
					break
				}
			}
		}
		s.mu.Unlock()
		s.redrawStatusBar()

	case "drive_granted":
		s.mu.Lock()
		if msg.UserID == s.UserID {
			s.Role = "driver"
		}
		s.mu.Unlock()
		s.redrawStatusBar()

	case "drive_released":
		s.mu.Lock()
		if msg.UserID == s.UserID {
			s.Role = "spectator"
		}
		s.mu.Unlock()
		s.redrawStatusBar()

	case "drive_request":
		// Notification to current driver
		s.drawNotification(msg.UserName, "requests to drive")

	case "suggestion":
		s.drawNotification(msg.UserName, "suggests: "+msg.Text)
	}
}

func (s *Session) handleDisconnect(err error) {
	s.cleanup()
	fmt.Fprintf(os.Stderr, "\nDisconnected: %v\n", err)
	os.Exit(1)
}

func (s *Session) redrawStatusBar() {
	if s.statusBar != nil {
		cols, rows, err := terminal.GetSize()
		if err == nil {
			s.statusBar.Draw(cols, rows)
		}
	}
}

func (s *Session) readStdin() {
	buf := make([]byte, 4096)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			return
		}
		if n == 0 {
			continue
		}

		data := buf[:n]

		// Check for Ctrl+Q (quit)
		if n == 1 && data[0] == 0x11 { // Ctrl+Q
			return
		}

		// Check for Ctrl+S (menu toggle)
		if n == 1 && data[0] == 0x13 { // Ctrl+S
			s.menu.Toggle()
			continue
		}

		// Check for double Ctrl+C (chat toggle)
		if n == 1 && data[0] == 0x03 { // Ctrl+C
			now := time.Now().UnixNano()
			if now-s.lastCtrlC < 500_000_000 { // 500ms window
				s.chat.Toggle()
				s.lastCtrlC = 0
				continue
			}
			s.lastCtrlC = now
			// If chat is not open, forward Ctrl+C to PTY
			if !s.chat.visible {
				s.mu.Lock()
				tid := s.TerminalID
				s.mu.Unlock()
				if tid != "" {
					s.Client.SendJSON(types.PtyInputMessage{
						Type:       "pty_input",
						TerminalID: tid,
						Input:      string(data),
					})
				}
			}
			continue
		}

		// If menu is open, route keys to menu
		if s.menu.visible {
			if n == 1 {
				if !s.menu.HandleKey(data[0]) {
					if data[0] == 'q' {
						return
					}
				}
			}
			continue
		}

		// If chat is open, route keys to chat
		if s.chat.visible {
			s.chat.HandleKey(data)
			continue
		}

		// Forward to PTY
		s.mu.Lock()
		tid := s.TerminalID
		s.mu.Unlock()

		if tid != "" {
			s.Client.SendJSON(types.PtyInputMessage{
				Type:       "pty_input",
				TerminalID: tid,
				Input:      string(data),
			})
		}
	}
}

