package terminal

import (
	"fmt"
	"os"
)

// FullRestore performs a complete terminal restoration:
// restore cooked mode, show cursor, reset scroll region, clear status line.
func FullRestore(restoreRaw func(), rows int) {
	if restoreRaw != nil {
		restoreRaw()
	}
	stdout := os.Stdout
	// Reset scroll region to full terminal
	fmt.Fprintf(stdout, "\033[r")
	// Move to bottom and clear
	fmt.Fprintf(stdout, "\033[%d;1H\033[K", rows)
	// Show cursor
	fmt.Fprintf(stdout, "\033[?25h")
	// Reset all attributes
	fmt.Fprintf(stdout, "\033[0m")
}
