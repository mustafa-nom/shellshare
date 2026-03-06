package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/shellshare/cli/internal/types"
)

const maxHistoryEntries = 50

func HistoryPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "history.json"), nil
}

func LoadHistory() ([]types.HistoryEntry, error) {
	path, err := HistoryPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var entries []types.HistoryEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func SaveHistory(entries []types.HistoryEntry) error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	// Trim to max entries
	if len(entries) > maxHistoryEntries {
		entries = entries[len(entries)-maxHistoryEntries:]
	}

	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}

	path := filepath.Join(dir, "history.json")
	return os.WriteFile(path, data, 0644)
}

func AddToHistory(roomCode, server, userName string) error {
	entries, err := LoadHistory()
	if err != nil {
		entries = nil
	}

	now := time.Now().Unix()

	// Update existing entry or add new one
	for i, e := range entries {
		if e.RoomCode == roomCode && e.Server == server {
			entries[i].LastVisit = now
			entries[i].UserName = userName
			return SaveHistory(entries)
		}
	}

	entries = append(entries, types.HistoryEntry{
		RoomCode:  roomCode,
		Server:    server,
		UserName:  userName,
		JoinedAt:  now,
		LastVisit: now,
	})

	return SaveHistory(entries)
}
