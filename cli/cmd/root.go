package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var (
	flagServer string
	flagName   string
)

var rootCmd = &cobra.Command{
	Use:   "shellshare",
	Short: "Share your terminal in real-time",
	Long:  "ShellShare CLI — create and join collaborative terminal sessions from the command line.",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringVar(&flagServer, "server", "", "WebSocket server URL (default from config)")
	rootCmd.PersistentFlags().StringVar(&flagName, "name", "", "Your display name")
}
