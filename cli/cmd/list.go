package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/shellshare/cli/internal/config"
	"github.com/spf13/cobra"
)

type roomStatus struct {
	Exists bool `json:"exists"`
	Users  int  `json:"users"`
	Locked bool `json:"locked"`
}

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List recently visited rooms",
	Long: `Show rooms from your history with their current status.

Examples:
  shellshare list`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}

		entries, err := config.LoadHistory()
		if err != nil {
			return fmt.Errorf("loading history: %w", err)
		}

		if len(entries) == 0 {
			fmt.Println("No rooms in history. Create one with: shellshare create")
			return nil
		}

		// Collect room codes to check status
		codes := make([]string, len(entries))
		for i, e := range entries {
			codes[i] = e.RoomCode
		}

		// Check status via API
		server := resolveServer(cfg)
		httpURL := strings.Replace(server, "ws://", "http://", 1)
		httpURL = strings.Replace(httpURL, "wss://", "https://", 1)

		statuses := make(map[string]roomStatus)
		reqBody, _ := json.Marshal(map[string]interface{}{"codes": codes})
		resp, err := http.Post(httpURL+"/api/rooms/status", "application/json", bytes.NewReader(reqBody))
		if err == nil {
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			json.Unmarshal(body, &statuses)
		}

		// Display table
		fmt.Printf("%-12s %-15s %-10s %-8s %s\n", "ROOM CODE", "NAME", "STATUS", "USERS", "LAST VISIT")
		fmt.Println(strings.Repeat("─", 65))

		// Show most recent first
		for i := len(entries) - 1; i >= 0; i-- {
			e := entries[i]
			status := "offline"
			users := "-"
			if s, ok := statuses[e.RoomCode]; ok && s.Exists {
				status = "active"
				users = fmt.Sprintf("%d", s.Users)
				if s.Locked {
					status = "locked"
				}
			}

			lastVisit := time.Unix(e.LastVisit, 0).Format("Jan 02 15:04")
			fmt.Printf("%-12s %-15s %-10s %-8s %s\n", e.RoomCode, e.UserName, status, users, lastVisit)
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(listCmd)
}
