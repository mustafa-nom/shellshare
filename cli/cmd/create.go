package cmd

import (
	"fmt"
	"os"

	"github.com/shellshare/cli/internal/config"
	"github.com/shellshare/cli/internal/session"
	"github.com/spf13/cobra"
)

var (
	createOpen      bool
	createPrivate   bool
	createShell     string
	createReadOnly  bool
	createClaudeCode bool
	createAPIKey    string
	createProject   string
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new ShellShare room",
	Long: `Create a new terminal sharing room. Others can join using the room code.

Examples:
  shellshare create
  shellshare create --name mustafa
  shellshare create --open      # Public room (findable via roulette)
  shellshare create --claude-code --api-key sk-ant-...`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}

		name := resolveName(cfg)
		server := resolveServer(cfg)

		roomCode := "CREATE"
		if createOpen {
			roomCode = "CREATE:open"
		}

		opts := session.Options{}
		if createClaudeCode {
			opts.Mode = "claude-code"
			opts.APIKey = createAPIKey
			if opts.APIKey == "" {
				opts.APIKey = os.Getenv("ANTHROPIC_API_KEY")
			}
			opts.Project = createProject
		}

		return session.Start(server, roomCode, name, opts)
	},
}

func init() {
	createCmd.Flags().BoolVar(&createOpen, "open", false, "Create a public room (findable via roulette)")
	createCmd.Flags().BoolVar(&createPrivate, "private", true, "Create a private room (default)")
	createCmd.Flags().StringVar(&createShell, "shell", "", "Shell to use (default: $SHELL)")
	createCmd.Flags().BoolVar(&createReadOnly, "read-only", false, "Spectators cannot type")
	createCmd.Flags().BoolVar(&createClaudeCode, "claude-code", false, "Create a Claude Code room")
	createCmd.Flags().StringVar(&createAPIKey, "api-key", "", "Anthropic API key for Claude Code mode")
	createCmd.Flags().StringVar(&createProject, "project", "", "Claude Code project name")
	rootCmd.AddCommand(createCmd)
}

func resolveName(cfg config.Config) string {
	if flagName != "" {
		return flagName
	}
	if cfg.Name != "" {
		return cfg.Name
	}
	hostname, _ := os.Hostname()
	if hostname != "" {
		return hostname
	}
	return fmt.Sprintf("user-%d", os.Getpid()%1000)
}

func resolveServer(cfg config.Config) string {
	if flagServer != "" {
		return flagServer
	}
	return cfg.Server
}
