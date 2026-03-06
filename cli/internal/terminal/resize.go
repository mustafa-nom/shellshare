//go:build !windows

package terminal

import (
	"os"
	"os/signal"
	"syscall"
)

// WatchResize calls the callback whenever the terminal is resized (SIGWINCH).
// Returns a stop function.
func WatchResize(onResize func(cols, rows int)) func() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGWINCH)

	done := make(chan struct{})

	go func() {
		for {
			select {
			case <-sigCh:
				cols, rows, err := GetSize()
				if err == nil {
					onResize(cols, rows)
				}
			case <-done:
				return
			}
		}
	}()

	return func() {
		signal.Stop(sigCh)
		close(done)
	}
}
