.PHONY: help build run queries test test-coverage lint fmt vet clean install-tools

# Variables
BINARY_NAME=todo-api
MAIN_PATH=./cmd/api
GO=go
GOTEST=$(GO) test
GOVET=$(GO) vet
GOFMT=gofmt
GOLINT=golangci-lint

# Colors for output
CYAN=\033[0;36m
GREEN=\033[0;32m
RED=\033[0;31m
NC=\033[0m # No Color

## help: Show this help message
help:
	@echo '$(CYAN)Usage:$(NC)'
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' | sed -e 's/^/ /'

## build: Build the application binary
build:
	@echo "$(CYAN)Building $(BINARY_NAME)...$(NC)"
	@$(GO) build -o bin/$(BINARY_NAME) $(MAIN_PATH)
	@echo "$(GREEN)✓ Build complete: bin/$(BINARY_NAME)$(NC)"

## run: Run the application
run: build
	@echo "$(CYAN)Running $(BINARY_NAME)...$(NC)"
	@./bin/$(BINARY_NAME)

## queries: Run test script to generate multiple MongoDB queries
queries:
	@echo "$(CYAN)Running query test script...$(NC)"
	@echo "$(CYAN)Make sure the API server is running on port 8080$(NC)"
	@$(GO) run ./cmd/test/main.go
	@echo "$(GREEN)✓ Query tests completed$(NC)"

## test: Run all tests
test:
	@echo "$(CYAN)Running tests...$(NC)"
	@$(GOTEST) -v -race ./...
	@echo "$(GREEN)✓ Tests passed$(NC)"

## test-coverage: Run tests with coverage report
test-coverage:
	@echo "$(CYAN)Running tests with coverage...$(NC)"
	@$(GOTEST) -v -race -coverprofile=coverage.out -covermode=atomic ./...
	@$(GO) tool cover -html=coverage.out -o coverage.html
	@echo "$(GREEN)✓ Coverage report generated: coverage.html$(NC)"

## lint: Run linter (golangci-lint)
lint:
	@echo "$(CYAN)Running linter...$(NC)"
	@if ! command -v $(GOLINT) > /dev/null; then \
		echo "$(RED)✗ golangci-lint not found. Run 'make install-tools' to install it.$(NC)"; \
		exit 1; \
	fi
	@$(GOLINT) run --timeout=5m
	@echo "$(GREEN)✓ Linting complete$(NC)"

## fmt: Format Go code
fmt:
	@echo "$(CYAN)Formatting code...$(NC)"
	@$(GOFMT) -s -w .
	@echo "$(GREEN)✓ Code formatted$(NC)"

## vet: Run go vet
vet:
	@echo "$(CYAN)Running go vet...$(NC)"
	@$(GOVET) ./...
	@echo "$(GREEN)✓ Vet complete$(NC)"

## check: Run all checks (fmt, vet, lint, test)
check: fmt vet lint test
	@echo "$(GREEN)✓ All checks passed!$(NC)"

## clean: Remove build artifacts
clean:
	@echo "$(CYAN)Cleaning build artifacts...$(NC)"
	@rm -rf bin/
	@rm -f coverage.out coverage.html
	@echo "$(GREEN)✓ Clean complete$(NC)"

## install-tools: Install required development tools
install-tools:
	@echo "$(CYAN)Installing development tools...$(NC)"
	@echo "Installing golangci-lint..."
	@curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(shell go env GOPATH)/bin
	@echo "$(GREEN)✓ Tools installed$(NC)"
	@echo "$(CYAN)Make sure $(shell go env GOPATH)/bin is in your PATH$(NC)"

## tidy: Tidy and verify Go modules
tidy:
	@echo "$(CYAN)Tidying Go modules...$(NC)"
	@$(GO) mod tidy
	@$(GO) mod verify
	@echo "$(GREEN)✓ Modules tidied$(NC)"

## deps: Download dependencies
deps:
	@echo "$(CYAN)Downloading dependencies...$(NC)"
	@$(GO) mod download
	@echo "$(GREEN)✓ Dependencies downloaded$(NC)"
