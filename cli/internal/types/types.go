package types

// ClientMessage types sent from CLI to server
type JoinMessage struct {
	Type     string `json:"type"`
	RoomCode string `json:"roomCode"`
	UserName string `json:"userName"`
	Mode     string `json:"mode,omitempty"`
	APIKey   string `json:"apiKey,omitempty"`
}

type ChatMessage struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type CommandMessage struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type PtyInputMessage struct {
	Type       string `json:"type"`
	TerminalID string `json:"terminalId"`
	Input      string `json:"input"`
}

type ResizeMessage struct {
	Type       string `json:"type"`
	TerminalID string `json:"terminalId"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

type TypingMessage struct {
	Type     string `json:"type"`
	IsTyping bool   `json:"isTyping"`
}

type SetVisibilityMessage struct {
	Type       string `json:"type"`
	Visibility string `json:"visibility"`
}

// RoomStatePayload is the nested room object in room_state messages
type RoomStatePayload struct {
	Code       string        `json:"code"`
	Locked     bool          `json:"locked"`
	Visibility string        `json:"visibility"`
	Mode       string        `json:"mode"`
	AdminID    string        `json:"adminId"`
	DriverID   string        `json:"driverId,omitempty"`
	Users      []UserInfo    `json:"users"`
	Messages   []ChatEntry   `json:"messages"`
	Terminals  []TerminalTab `json:"terminals"`
}

// ServerMessage types received from server
type ServerMessage struct {
	Type string `json:"type"`

	// room_state: { room: {...}, userId: "..." }
	Room   *RoomStatePayload `json:"room,omitempty"`
	UserID string            `json:"userId,omitempty"`

	// Flat fields used by other message types
	Code       string        `json:"code,omitempty"`
	Locked     bool          `json:"locked,omitempty"`
	Visibility string        `json:"visibility,omitempty"`
	Mode       string        `json:"mode,omitempty"`
	AdminID    string        `json:"adminId,omitempty"`
	DriverID   string        `json:"driverId,omitempty"`
	Users      []UserInfo    `json:"users,omitempty"`
	Messages   []ChatEntry   `json:"messages,omitempty"`
	Terminals  []TerminalTab `json:"terminals,omitempty"`

	// user_joined / user_left
	User *UserInfo `json:"user,omitempty"`

	// chat_message: { message: { ... } }
	ChatMsg *ChatMessagePayload `json:"message,omitempty"`

	// chat_message flat fields (also used by other types)
	ID        string `json:"id,omitempty"`
	Text      string `json:"text,omitempty"`
	IsSystem  bool   `json:"isSystem,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	UserColor string `json:"userColor,omitempty"`

	// error
	Message string `json:"message,omitempty"`

	// typing_update
	TypingUsers []string `json:"typingUsers,omitempty"`

	// terminal_created / terminal_closed / terminal_renamed
	Terminal   *TerminalTab `json:"terminal,omitempty"`
	TerminalID string       `json:"terminalId,omitempty"`
	Label      string       `json:"label,omitempty"`

	// roulette
	RoomCode string `json:"roomCode,omitempty"`

	// kicked
	Reason string `json:"reason,omitempty"`

	// drive/suggestion (Claude Code mode)
	UserName string `json:"userName,omitempty"`
	Role     string `json:"role,omitempty"`
}

type UserInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	IsAdmin   bool   `json:"isAdmin"`
	JoinOrder int    `json:"joinOrder"`
	Role      string `json:"role,omitempty"`
}

type ChatEntry struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	UserName  string `json:"userName"`
	UserColor string `json:"userColor"`
	Text      string `json:"text"`
	IsSystem  bool   `json:"isSystem"`
	Timestamp int64  `json:"timestamp"`
}

type TerminalTab struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// ChatMessagePayload is the nested message object in chat_message events
type ChatMessagePayload struct {
	Type     string `json:"type"` // "user", "system", "cow"
	UserID   string `json:"userId,omitempty"`
	UserName string `json:"userName,omitempty"`
	Color    string `json:"color,omitempty"`
	Text     string `json:"text"`
	Ts       int64  `json:"ts"`
}

// RoomState holds the current state of a joined room
type RoomState struct {
	Code       string
	Locked     bool
	Visibility string
	Mode       string
	AdminID    string
	DriverID   string
	Users      []UserInfo
	Messages   []ChatEntry
	Terminals  []TerminalTab
	UserID     string
}

// HistoryEntry represents a previously visited room
type HistoryEntry struct {
	RoomCode  string `json:"roomCode"`
	Server    string `json:"server"`
	UserName  string `json:"userName"`
	JoinedAt  int64  `json:"joinedAt"`
	LastVisit int64  `json:"lastVisit"`
}
