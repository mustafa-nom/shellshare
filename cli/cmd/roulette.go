package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/shellshare/cli/internal/config"
	"github.com/shellshare/cli/internal/session"
	"github.com/spf13/cobra"
)

type rouletteResponse struct {
	RoomCode string `json:"roomCode"`
	Users    []struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	} `json:"users"`
}

var rouletteCmd = &cobra.Command{
	Use:   "roulette",
	Short: "Join a random public room",
	Long: `Find and join a random public ShellShare room.

Examples:
  shellshare roulette
  shellshare roulette --name explorer`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}

		server := resolveServer(cfg)
		name := resolveName(cfg)

		// Convert ws:// to http:// for REST call
		httpURL := strings.Replace(server, "ws://", "http://", 1)
		httpURL = strings.Replace(httpURL, "wss://", "https://", 1)

		fmt.Println("Looking for a public room...")

		resp, err := http.Get(httpURL + "/api/roulette")
		if err != nil {
			return fmt.Errorf("contacting server: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("reading response: %w", err)
		}

		var result rouletteResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return fmt.Errorf("parsing response: %w", err)
		}

		if result.RoomCode == "" {
			fmt.Println("No public rooms available. Try creating one with: shellshare create --open")
			return nil
		}

		fmt.Printf("Found room %s with %d user(s)\n", result.RoomCode, len(result.Users))
		for _, u := range result.Users {
			fmt.Printf("  - %s\n", u.Name)
		}
		fmt.Println()

		return session.Start(server, result.RoomCode, name)
	},
}

func init() {
	rootCmd.AddCommand(rouletteCmd)
}
