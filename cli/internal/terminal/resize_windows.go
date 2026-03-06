//go:build windows

package terminal

// WatchResize is a no-op on Windows (SIGWINCH not available).
// Terminal resize detection on Windows would require polling or Windows Console API.
func WatchResize(onResize func(cols, rows int)) func() {
	return func() {}
}
