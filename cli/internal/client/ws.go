package client

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shellshare/cli/internal/types"
)

// Handler callbacks for received messages
type Handler struct {
	OnPtyOutput  func(terminalID string, data []byte)
	OnMessage    func(msg types.ServerMessage)
	OnDisconnect func(err error)
}

// Client manages the WebSocket connection to the ShellShare server
type Client struct {
	url     string
	conn    *websocket.Conn
	handler Handler
	mu      sync.Mutex
	done    chan struct{}
	closed  bool
}

// New creates a new WebSocket client
func New(serverURL string, handler Handler) *Client {
	return &Client{
		url:     serverURL,
		handler: handler,
		done:    make(chan struct{}),
	}
}

// Connect establishes the WebSocket connection
func (c *Client) Connect() error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	header := http.Header{}
	header.Set("X-ShellShare-Client", "cli")

	conn, _, err := dialer.Dial(c.url, header)
	if err != nil {
		return fmt.Errorf("connecting to %s: %w", c.url, err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	// Set up pong handler for keepalive
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})

	// Start read loop
	go c.readLoop()

	// Start ping loop
	go c.pingLoop()

	return nil
}

// SendJSON sends a JSON message
func (c *Client) SendJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	return c.conn.WriteJSON(v)
}

// Close cleanly shuts down the connection
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	close(c.done)
	if c.conn != nil {
		// Send close frame
		c.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		return c.conn.Close()
	}
	return nil
}

// Done returns a channel that's closed when the client is done
func (c *Client) Done() <-chan struct{} {
	return c.done
}

func (c *Client) readLoop() {
	defer func() {
		c.mu.Lock()
		if !c.closed {
			c.closed = true
			close(c.done)
		}
		c.mu.Unlock()
	}()

	for {
		msgType, data, err := c.conn.ReadMessage()
		if err != nil {
			if !c.isClosed() {
				if c.handler.OnDisconnect != nil {
					c.handler.OnDisconnect(err)
				}
			}
			return
		}

		switch msgType {
		case websocket.BinaryMessage:
			frame, err := ParsePtyFrame(data)
			if err != nil {
				continue
			}
			if c.handler.OnPtyOutput != nil {
				c.handler.OnPtyOutput(frame.TerminalID, frame.Data)
			}

		case websocket.TextMessage:
			var msg types.ServerMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			if c.handler.OnMessage != nil {
				c.handler.OnMessage(msg)
			}
		}
	}
}

func (c *Client) pingLoop() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.mu.Lock()
			if c.conn != nil {
				c.conn.WriteMessage(websocket.PingMessage, nil)
			}
			c.mu.Unlock()
		case <-c.done:
			return
		}
	}
}

func (c *Client) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}
