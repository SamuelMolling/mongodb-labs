.PHONY: help install setup indexes seed smoke \
        dev dev-backend dev-frontend stop health clean check-env \
        backend-install frontend-install

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------
BACKEND_DIR  := backend
FRONTEND_DIR := frontend

# Ports the dev servers bind to (used by `make stop`).
# 4020/3020 so this lab can run side by side with knowledge-base (4010/3010).
BACKEND_PORT  ?= 4020
FRONTEND_PORT ?= 3020

# Colors
CYAN  := \033[0;36m
GREEN := \033[0;32m
YELLOW:= \033[0;33m
RED   := \033[0;31m
NC    := \033[0m

# ---------------------------------------------------------------------------
# Help (default target)
# ---------------------------------------------------------------------------
.DEFAULT_GOAL := help

## help: Show this help message
help:
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Support Agent — MongoDB context-aware customer support$(NC)'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Usage:$(NC) make <target> [VAR=value]'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Targets:$(NC)'
	@sed -n 's/^##//p' $(MAKEFILE_LIST) | column -t -s ':' | sed -e 's/^/ /'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Common flows:$(NC)'
	@printf '%b\n' '  $(GREEN)make setup$(NC)   first-time bootstrap (install + indexes + seed)'
	@printf '%b\n' '  $(GREEN)make dev$(NC)     run backend + frontend in parallel (Ctrl+C stops both)'
	@printf '%b\n' '  $(GREEN)make smoke$(NC)   offline tests — no cluster, no API keys'
	@printf '%b\n' ''

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
## install: Install backend + frontend dependencies
install: backend-install frontend-install
	@printf '%b\n' "$(GREEN)✓ All dependencies installed$(NC)"

backend-install:
	@printf '%b\n' "$(CYAN)→ installing backend dependencies$(NC)"
	@cd $(BACKEND_DIR) && npm install
	@if [ ! -f $(BACKEND_DIR)/.env ]; then \
		cp $(BACKEND_DIR)/.env.example $(BACKEND_DIR)/.env; \
		echo "$(YELLOW)⚠ created $(BACKEND_DIR)/.env from .env.example — edit it before running$(NC)"; \
	fi

frontend-install:
	@printf '%b\n' "$(CYAN)→ installing frontend dependencies$(NC)"
	@cd $(FRONTEND_DIR) && npm install
	@if [ ! -f $(FRONTEND_DIR)/.env.local ]; then \
		cp $(FRONTEND_DIR)/.env.example $(FRONTEND_DIR)/.env.local; \
		echo "$(YELLOW)⚠ created $(FRONTEND_DIR)/.env.local from .env.example$(NC)"; \
	fi

# ---------------------------------------------------------------------------
# Setup (one-shot first run)
# ---------------------------------------------------------------------------
## setup: install + create indexes + seed (first-time bootstrap)
setup: install check-env indexes seed
	@printf '%b\n' ''
	@printf '%b\n' "$(GREEN)✓ Setup complete$(NC)"
	@printf '%b\n' "$(CYAN)Next: $(NC)make dev"

# ---------------------------------------------------------------------------
# MongoDB
# ---------------------------------------------------------------------------
## indexes: Create regular + Atlas Search + Vector Search indexes
indexes: check-env
	@printf '%b\n' "$(CYAN)→ creating MongoDB indexes (Atlas Search + Vector Search may take ~1-2 min to build)$(NC)"
	@cd $(BACKEND_DIR) && npm run create-indexes

## seed: Seed demo customers, orders, KB articles and resolved tickets
seed: check-env
	@printf '%b\n' "$(CYAN)→ seeding demo data$(NC)"
	@cd $(BACKEND_DIR) && npm run seed

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
## smoke: Offline tests — chunker, entitlement, policy, HTTP (no cluster, no keys)
#
# Deliberately does NOT depend on check-env: the point of this target is that
# it runs on a fresh clone with no .env, no cluster and no API keys.
smoke:
	@printf '%b\n' "$(CYAN)→ running offline smoke tests$(NC)"
	@cd $(BACKEND_DIR) && npm run --silent smoke

# ---------------------------------------------------------------------------
# Dev servers
# ---------------------------------------------------------------------------
## dev: Run backend + frontend in parallel (Ctrl+C stops both)
dev: check-env
	@printf '%b\n' "$(CYAN)→ starting backend on :$(BACKEND_PORT) and frontend on :$(FRONTEND_PORT)$(NC)"
	@printf '%b\n' "$(YELLOW)  Ctrl+C to stop both$(NC)"
	@printf '%b\n' ''
	@trap 'echo "\n$(CYAN)→ stopping services...$(NC)"; kill 0' INT TERM; \
		(cd $(BACKEND_DIR) && npm run dev 2>&1 | sed -u 's/^/$(GREEN)[backend]$(NC)  /') & \
		(cd $(FRONTEND_DIR) && npm run dev 2>&1 | sed -u 's/^/$(CYAN)[frontend]$(NC) /') & \
		wait

## dev-backend: Run only the backend (port 4020)
dev-backend: check-env
	@printf '%b\n' "$(CYAN)→ starting backend on :$(BACKEND_PORT)$(NC)"
	@cd $(BACKEND_DIR) && npm run dev

## dev-frontend: Run only the frontend (port 3020)
dev-frontend:
	@printf '%b\n' "$(CYAN)→ starting frontend on :$(FRONTEND_PORT)$(NC)"
	@cd $(FRONTEND_DIR) && npm run dev

# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------
## stop: Kill processes occupying backend and frontend ports
stop:
	@printf '%b\n' "$(CYAN)→ killing processes on :$(BACKEND_PORT) and :$(FRONTEND_PORT)$(NC)"
	@lsof -ti tcp:$(BACKEND_PORT)  | xargs kill -9 2>/dev/null || echo "  (nothing on :$(BACKEND_PORT))"
	@lsof -ti tcp:$(FRONTEND_PORT) | xargs kill -9 2>/dev/null || echo "  (nothing on :$(FRONTEND_PORT))"
	@printf '%b\n' "$(GREEN)✓ stopped$(NC)"

## health: Curl the backend /health endpoint
health:
	@curl -fsS http://localhost:$(BACKEND_PORT)/health \
		&& echo " $(GREEN)✓ backend up$(NC)" \
		|| echo "$(RED)✗ backend not reachable on :$(BACKEND_PORT)$(NC)"

## clean: Remove node_modules and build artifacts (keeps .env files)
clean:
	@printf '%b\n' "$(CYAN)→ removing node_modules and build output$(NC)"
	@rm -rf $(BACKEND_DIR)/node_modules
	@rm -rf $(FRONTEND_DIR)/node_modules
	@rm -rf $(FRONTEND_DIR)/.next
	@printf '%b\n' "$(GREEN)✓ clean$(NC)"

# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------
check-env:
	@if [ ! -f $(BACKEND_DIR)/.env ]; then \
		echo "$(RED)✗ $(BACKEND_DIR)/.env not found. Run 'make install' first or copy .env.example$(NC)"; \
		exit 1; \
	fi
	@if ! grep -q "^MONGODB_URI=mongodb" $(BACKEND_DIR)/.env; then \
		echo "$(RED)✗ MONGODB_URI looks unset in $(BACKEND_DIR)/.env$(NC)"; \
		exit 1; \
	fi
	@if ! grep -q "^VOYAGE_API_KEY=" $(BACKEND_DIR)/.env || grep -Eq "^VOYAGE_API_KEY=(al-xxxx|pa-xxxx)" $(BACKEND_DIR)/.env; then \
		echo "$(YELLOW)⚠ VOYAGE_API_KEY not set in $(BACKEND_DIR)/.env — embedding calls will fail$(NC)"; \
	fi
	@if ! grep -q "^OPENAI_API_KEY=sk-" $(BACKEND_DIR)/.env || grep -q "^OPENAI_API_KEY=sk-xxxx" $(BACKEND_DIR)/.env; then \
		echo "$(YELLOW)⚠ OPENAI_API_KEY not set in $(BACKEND_DIR)/.env — condense and generation will fail$(NC)"; \
	fi
