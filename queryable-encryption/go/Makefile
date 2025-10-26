.PHONY: help build run test lint fmt vet clean deps install-tools

# Variables
BINARY_NAME=queryable-encryption-hr
MAIN_PATH=./cmd/api
GO=go
GOTEST=$(GO) test
GOVET=$(GO) vet
GOFMT=gofmt
GOLINT=golangci-lint

# Colors
CYAN=\033[0;36m
GREEN=\033[0;32m
NC=\033[0m

## help: Show this help message
help:
	@echo '$(CYAN)Usage:$(NC)'
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' | sed -e 's/^/ /'

## build: Build the application
build:
	@echo "$(CYAN)Building $(BINARY_NAME) with encryption support...$(NC)"
	@$(GO) build -tags cse -o bin/$(BINARY_NAME) $(MAIN_PATH)
	@echo "$(GREEN)✓ Build complete: bin/$(BINARY_NAME)$(NC)"

## run: Run the application
run:
	@echo "$(CYAN)Running $(BINARY_NAME)...$(NC)"
	@$(GO) run -tags cse $(MAIN_PATH)/main.go

## test: Run all tests
test:
	@echo "$(CYAN)Running tests...$(NC)"
	@$(GOTEST) -v -race ./...
	@echo "$(GREEN)✓ Tests passed$(NC)"

## test-coverage: Run tests with coverage
test-coverage:
	@echo "$(CYAN)Running tests with coverage...$(NC)"
	@$(GOTEST) -v -race -coverprofile=coverage.out -covermode=atomic ./...
	@$(GO) tool cover -html=coverage.out -o coverage.html
	@echo "$(GREEN)✓ Coverage report: coverage.html$(NC)"

## lint: Run linter
lint:
	@echo "$(CYAN)Running linter...$(NC)"
	@if ! command -v $(GOLINT) > /dev/null; then \
		echo "$(CYAN)golangci-lint not found. Install with: make install-tools$(NC)"; \
		exit 1; \
	fi
	@$(GOLINT) run --timeout=5m
	@echo "$(GREEN)✓ Linting complete$(NC)"

## fmt: Format code
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
	@echo "$(CYAN)Cleaning...$(NC)"
	@rm -rf bin/
	@rm -f coverage.out coverage.html
	@rm -f local_master_key.txt
	@echo "$(GREEN)✓ Clean complete$(NC)"

## deps: Download dependencies
deps:
	@echo "$(CYAN)Downloading dependencies...$(NC)"
	@$(GO) mod download
	@$(GO) mod verify
	@echo "$(GREEN)✓ Dependencies downloaded$(NC)"

## tidy: Tidy go modules
tidy:
	@echo "$(CYAN)Tidying modules...$(NC)"
	@$(GO) mod tidy
	@echo "$(GREEN)✓ Modules tidied$(NC)"

## install-tools: Install development tools
install-tools:
	@echo "$(CYAN)Installing development tools...$(NC)"
	@echo "Installing golangci-lint..."
	@curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(shell go env GOPATH)/bin
	@echo "$(GREEN)✓ Tools installed$(NC)"

## setup: Initial project setup
setup: deps
	@echo "$(CYAN)Setting up project...$(NC)"
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(GREEN)✓ Created .env file$(NC)"; \
		echo "$(CYAN)⚠️  Please edit .env with your MongoDB URI$(NC)"; \
	else \
		echo "$(CYAN).env already exists$(NC)"; \
	fi
	@echo "$(GREEN)✓ Setup complete!$(NC)"
	@echo "$(CYAN)Next steps:$(NC)"
	@echo "  1. Edit .env file with your MongoDB URI"
	@echo "  2. Run 'make run' to start the application"
	@echo "  3. Open http://localhost:8080 in your browser"
