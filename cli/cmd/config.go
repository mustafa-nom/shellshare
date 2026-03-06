package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/shellshare/cli/internal/config"
	"github.com/spf13/cobra"
)

var configListFlag bool

var configCmd = &cobra.Command{
	Use:   "config [key] [value]",
	Short: "Get or set configuration values",
	Long: `Manage ShellShare CLI configuration.

Examples:
  shellshare config --list          Show all config values
  shellshare config name            Get the "name" value
  shellshare config name mustafa    Set "name" to "mustafa"
  shellshare config server ws://example.com:3001`,
	Args: cobra.MaximumNArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		if configListFlag || len(args) == 0 {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			data, err := json.MarshalIndent(cfg, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}

		key := args[0]

		if len(args) == 1 {
			val, err := config.Get(key)
			if err != nil {
				return err
			}
			if val == "" {
				fmt.Println("(not set)")
			} else {
				fmt.Println(val)
			}
			return nil
		}

		value := args[1]
		if err := config.Set(key, value); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "Set %s = %s\n", key, value)
		return nil
	},
}

func init() {
	configCmd.Flags().BoolVar(&configListFlag, "list", false, "Show all configuration values")
	rootCmd.AddCommand(configCmd)
}
