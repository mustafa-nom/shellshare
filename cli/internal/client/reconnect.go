package client

import (
	"fmt"
	"time"
)

const (
	maxReconnectAttempts = 5
	baseReconnectDelay   = 2 * time.Second
)

// ConnectWithRetry attempts to connect with exponential backoff
func (c *Client) ConnectWithRetry() error {
	var lastErr error
	for attempt := 0; attempt < maxReconnectAttempts; attempt++ {
		if attempt > 0 {
			delay := baseReconnectDelay * time.Duration(1<<uint(attempt-1))
			fmt.Printf("\rReconnecting (attempt %d/%d)...", attempt+1, maxReconnectAttempts)
			time.Sleep(delay)
		}

		err := c.Connect()
		if err == nil {
			return nil
		}
		lastErr = err
	}
	return fmt.Errorf("failed after %d attempts: %w", maxReconnectAttempts, lastErr)
}
