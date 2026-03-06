VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE    ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
LDFLAGS  = -s -w -X github.com/shellshare/cli/cmd.Version=$(VERSION) \
                   -X github.com/shellshare/cli/cmd.CommitSHA=$(COMMIT) \
                   -X github.com/shellshare/cli/cmd.BuildDate=$(DATE)

.PHONY: build build-all clean test

build:
	go build -ldflags '$(LDFLAGS)' -o shellshare .

build-all:
	GOOS=darwin  GOARCH=arm64 go build -ldflags '$(LDFLAGS)' -o dist/shellshare-darwin-arm64 .
	GOOS=darwin  GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o dist/shellshare-darwin-amd64 .
	GOOS=linux   GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o dist/shellshare-linux-amd64 .
	GOOS=linux   GOARCH=arm64 go build -ldflags '$(LDFLAGS)' -o dist/shellshare-linux-arm64 .
	GOOS=windows GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o dist/shellshare-windows-amd64.exe .

clean:
	rm -rf shellshare dist/

test:
	go test ./...
