package terminal

import (
	"os"

	"golang.org/x/term"
)

// RawMode puts the terminal into raw mode and returns a restore function.
func RawMode() (restore func(), err error) {
	fd := int(os.Stdin.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return nil, err
	}

	return func() {
		term.Restore(fd, oldState)
	}, nil
}

// GetSize returns the current terminal dimensions.
func GetSize() (cols, rows int, err error) {
	cols, rows, err = term.GetSize(int(os.Stdout.Fd()))
	return
}
