package cmd

import (
	"fmt"

	"github.com/shellshare/cli/internal/config"
	"github.com/shellshare/cli/internal/session"
	"github.com/spf13/cobra"
)

var joinCmd = &cobra.Command{
	Use:   "join <room-code>",
	Short: "Join an existing ShellShare room",
	Long: `Join a terminal sharing room using a room code.

Examples:
  shellshare join ABCD-1234
  shellshare join ABCD-1234 --name guest`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}

		roomCode := args[0]
		name := resolveName(cfg)
		server := resolveServer(cfg)

		fmt.Printf("Joining room %s...\n", roomCode)
		return session.Start(server, roomCode, name)
	},
}

func init() {
	rootCmd.AddCommand(joinCmd)
}
