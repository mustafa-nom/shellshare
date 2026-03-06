package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Keybindings struct {
	Menu string `json:"menu"`
	Chat string `json:"chat"`
	Quit string `json:"quit"`
}

type Config struct {
	Name                 string      `json:"name"`
	Server               string      `json:"server"`
	PreferredColor       string      `json:"preferredColor"`
	Shell                string      `json:"shell"`
	StatusBar            bool        `json:"statusBar"`
	Notifications        bool        `json:"notifications"`
	NotificationDuration int         `json:"notificationDuration"`
	ChatPanelHeight      int         `json:"chatPanelHeight"`
	Keybindings          Keybindings `json:"keybindings"`
}

func DefaultConfig() Config {
	return Config{
		Server:               "ws://localhost:3001",
		StatusBar:            true,
		Notifications:        true,
		NotificationDuration: 3,
		ChatPanelHeight:      30,
		Keybindings: Keybindings{
			Menu: "ctrl+s",
			Chat: "ctrl+c ctrl+c",
			Quit: "ctrl+q",
		},
	}
}

func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot find home directory: %w", err)
	}
	return filepath.Join(home, ".shellshare"), nil
}

func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

func Load() (Config, error) {
	cfg := DefaultConfig()
	path, err := Path()
	if err != nil {
		return cfg, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, fmt.Errorf("reading config: %w", err)
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parsing config: %w", err)
	}
	return cfg, nil
}

func Save(cfg Config) error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}

	path := filepath.Join(dir, "config.json")
	return os.WriteFile(path, data, 0644)
}

func Get(key string) (string, error) {
	cfg, err := Load()
	if err != nil {
		return "", err
	}

	switch key {
	case "name":
		return cfg.Name, nil
	case "server":
		return cfg.Server, nil
	case "preferredColor":
		return cfg.PreferredColor, nil
	case "shell":
		return cfg.Shell, nil
	default:
		return "", fmt.Errorf("unknown config key: %s", key)
	}
}

func Set(key, value string) error {
	cfg, err := Load()
	if err != nil {
		return err
	}

	switch key {
	case "name":
		cfg.Name = value
	case "server":
		cfg.Server = value
	case "preferredColor":
		cfg.PreferredColor = value
	case "shell":
		cfg.Shell = value
	default:
		return fmt.Errorf("unknown config key: %s", key)
	}

	return Save(cfg)
}
