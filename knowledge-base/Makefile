.PHONY: help install setup setup-bulk indexes seed seed-bulk seed-bulk-noembed \
        dev dev-backend dev-frontend stop health clean check-env \
        backend-install frontend-install

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------
BACKEND_DIR  := backend
FRONTEND_DIR := frontend

# Bulk seed defaults — override on the command line:
#   make seed-bulk COUNT=5000 WORKSPACE=demo-large EMBED_BATCH=128
COUNT        ?= 1000
WORKSPACE    ?= demo-bulk
EMBED_BATCH  ?= 96
INSERT_BATCH ?= 250
CONCURRENCY  ?= 4

# Ports the dev servers bind to (used by `make stop`)
BACKEND_PORT  ?= 4010
FRONTEND_PORT ?= 3010

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
	@printf '%b\n' '$(CYAN)Knowledge Base — MongoDB AI Search$(NC)'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Usage:$(NC) make <target> [VAR=value]'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Targets:$(NC)'
	@sed -n 's/^##//p' $(MAKEFILE_LIST) | column -t -s ':' | sed -e 's/^/ /'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Common flows:$(NC)'
	@printf '%b\n' '  $(GREEN)make setup$(NC)        first-time bootstrap (install + indexes + small seed)'
	@printf '%b\n' '  $(GREEN)make dev$(NC)          run backend + frontend in parallel (Ctrl+C stops both)'
	@printf '%b\n' '  $(GREEN)make seed-bulk COUNT=5000$(NC)   bulk seed with 5k synthetic articles'
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
## setup: install + create indexes + small seed (first-time bootstrap)
setup: install check-env indexes seed
	@printf '%b\n' ''
	@printf '%b\n' "$(GREEN)✓ Setup complete$(NC)"
	@printf '%b\n' "$(CYAN)Next: $(NC)make dev"

## setup-bulk: install + create indexes + bulk seed (uses COUNT, default 1000)
setup-bulk: install check-env indexes seed-bulk
	@printf '%b\n' ''
	@printf '%b\n' "$(GREEN)✓ Bulk setup complete$(NC)"
	@printf '%b\n' "$(CYAN)Next: $(NC)make dev"

# ---------------------------------------------------------------------------
# MongoDB
# ---------------------------------------------------------------------------
## indexes: Create regular + Atlas Search + Vector Search indexes
indexes: check-env
	@printf '%b\n' "$(CYAN)→ creating MongoDB indexes (Atlas Search + Vector Search may take ~1-2 min to build)$(NC)"
	@cd $(BACKEND_DIR) && npm run create-indexes

## seed: Seed demo workspace with ~6 curated articles + embeddings
seed: check-env
	@printf '%b\n' "$(CYAN)→ seeding demo workspace$(NC)"
	@cd $(BACKEND_DIR) && npm run seed

## seed-bulk: Seed N synthetic articles — vars COUNT, WORKSPACE, EMBED_BATCH, CONCURRENCY
seed-bulk: check-env
	@printf '%b\n' "$(CYAN)→ bulk seeding $(COUNT) articles into workspace '$(WORKSPACE)'$(NC)"
	@cd $(BACKEND_DIR) && npm run seed-bulk -- \
		--count=$(COUNT) \
		--workspace=$(WORKSPACE) \
		--embed-batch=$(EMBED_BATCH) \
		--insert-batch=$(INSERT_BATCH) \
		--concurrency=$(CONCURRENCY) \
		--reset

## seed-bulk-noembed: Bulk seed without Voyage embeddings (fast, no API spend)
seed-bulk-noembed: check-env
	@printf '%b\n' "$(CYAN)→ bulk seeding $(COUNT) articles (no embeddings)$(NC)"
	@cd $(BACKEND_DIR) && npm run seed-bulk -- \
		--count=$(COUNT) \
		--workspace=$(WORKSPACE) \
		--no-embed \
		--reset

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

## dev-backend: Run only the backend (port 4010)
dev-backend: check-env
	@printf '%b\n' "$(CYAN)→ starting backend on :$(BACKEND_PORT)$(NC)"
	@cd $(BACKEND_DIR) && npm run dev

## dev-frontend: Run only the frontend (port 3010)
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
