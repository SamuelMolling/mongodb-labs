.PHONY: help install setup db bootstrap train status promote canary shadow rollback \
        dev dev-control-plane dev-frontend serve serve-one load smoke e2e \
        stop health clean check-env check-python

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------
CP_DIR := control-plane
FE_DIR := frontend
PY_DIR := python
VENV   := $(PY_DIR)/.venv
# relative to $(PY_DIR)
PY     := .venv/bin/python
PYTHON ?= python3

MODEL  ?= churn-classifier

# 4030/3030 so this lab runs side by side with knowledge-base (4010/3010)
# and support-chatbot (4020/3020). Two serving nodes, so there is a fleet.
CP_PORT     ?= 4030
FE_PORT     ?= 3030
NODE_A_PORT ?= 8031
NODE_B_PORT ?= 8032

# make train VARIANT=gbt | logreg | broken
VARIANT ?= gbt
# make promote V=2 · make canary V=2 PCT=10 · make shadow V=3 (or V=off)
V   ?=
PCT ?= 10
# make load RPS=10 DRIFT=0.6 NULL_FEATURE=tenure_days
RPS  ?= 10
DRIFT ?= 0
NULL_FEATURE ?=

# Colors
CYAN  := \033[0;36m
GREEN := \033[0;32m
YELLOW:= \033[0;33m
RED   := \033[0;31m
NC    := \033[0m

.DEFAULT_GOAL := help

## help: Show this help message
help:
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Model Serving Platform — deploy, version and serve ML models on MongoDB$(NC)'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Usage:$(NC) make <target> [VAR=value]'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Targets:$(NC)'
	@sed -n 's/^##//p' $(MAKEFILE_LIST) | column -t -s ':' | sed -e 's/^/ /'
	@printf '%b\n' ''
	@printf '%b\n' '$(CYAN)Common flows:$(NC)'
	@printf '%b\n' '  $(GREEN)make setup$(NC)              install + db + train v1 (logreg, promoted) and v2 (gbt, staging)'
	@printf '%b\n' '  $(GREEN)make dev$(NC)                control plane + UI + two serving nodes (Ctrl+C stops all)'
	@printf '%b\n' '  $(GREEN)make load$(NC)               traffic in another terminal; DRIFT=0.6 for a new cohort'
	@printf '%b\n' '  $(GREEN)make smoke$(NC)              offline tests, Node + Python — no cluster'
	@printf '%b\n' '  $(GREEN)make e2e$(NC)                checks against your real cluster (throwaway database)'
	@printf '%b\n' ''

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
## install: Install Node deps, create the Python venv, copy .env files
install: check-python
	@printf '%b\n' "$(CYAN)→ control plane dependencies$(NC)"
	@cd $(CP_DIR) && npm install
	@printf '%b\n' "$(CYAN)→ frontend dependencies$(NC)"
	@cd $(FE_DIR) && npm install
	@printf '%b\n' "$(CYAN)→ python venv ($(VENV))$(NC)"
	@test -d $(VENV) || $(PYTHON) -m venv $(VENV)
	@$(VENV)/bin/pip install --quiet --upgrade pip
	@$(VENV)/bin/pip install --quiet -r $(PY_DIR)/requirements.txt
	@if [ ! -f .env ]; then cp .env.example .env; \
		echo "$(YELLOW)⚠ created .env from .env.example — set MONGODB_URI before running$(NC)"; fi
	@if [ ! -f $(FE_DIR)/.env.local ]; then cp $(FE_DIR)/.env.example $(FE_DIR)/.env.local; fi
	@printf '%b\n' "$(GREEN)✓ installed$(NC)"

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
## setup: install + db + bootstrap (first run)
setup: install check-env db bootstrap
	@printf '%b\n' ''
	@printf '%b\n' "$(GREEN)✓ Setup complete$(NC)"
	@printf '%b\n' "$(CYAN)Next:$(NC) make dev   (then, in another terminal: make load)"

## db: Collections, validators, partial unique index, time series, demo model
db: check-env
	@printf '%b\n' "$(CYAN)→ creating collections, validators and indexes$(NC)"
	@cd $(CP_DIR) && npm run --silent setup-db

## bootstrap: Train+register v1 (logreg) and promote it, then v2 (gbt) — skipped if versions exist
bootstrap: check-env
	@n=$$(cd $(CP_DIR) && node scripts/deploy.js count $(MODEL) | tail -1); \
	case "$$n" in ''|*[!0-9]*) echo "$(RED)✗ could not count versions (did make db succeed?)$(NC)"; exit 1;; esac; \
	if [ "$$n" != "0" ]; then \
		echo "  = $(MODEL) already has $$n version(s); skipping bootstrap (use make train)"; \
	else \
		$(MAKE) --no-print-directory train VARIANT=logreg && \
		(cd $(CP_DIR) && node scripts/deploy.js promote $(MODEL) 1) && \
		$(MAKE) --no-print-directory train VARIANT=gbt; \
	fi

## train: Train VARIANT (logreg|gbt|broken), upload the artifact, register a version
train: check-env
	@printf '%b\n' "$(CYAN)→ training $(VARIANT)$(NC)"
	@cd $(PY_DIR) && $(PY) -m trainer.train --model $(MODEL) --variant $(VARIANT)
	@cd $(CP_DIR) && node scripts/register.js ../$(PY_DIR)/trainer/out/$(MODEL)-$(VARIANT).json

# ---------------------------------------------------------------------------
# Deployment operations (same code path as the API and the UI)
# ---------------------------------------------------------------------------
## status: Show the deployment's routes and revision
status: check-env
	@cd $(CP_DIR) && node scripts/deploy.js status $(MODEL)

## promote: Promote V to 100% (make promote V=2)
promote: check-env
	@test -n "$(V)" || (echo "$(RED)✗ usage: make promote V=<version>$(NC)"; exit 1)
	@cd $(CP_DIR) && node scripts/deploy.js promote $(MODEL) $(V)

## canary: Canary V at PCT percent (make canary V=2 PCT=10; PCT=0 stops it)
canary: check-env
	@cd $(CP_DIR) && node scripts/deploy.js canary $(MODEL) $(or $(V),0) $$(( $(PCT) * 100 ))

## shadow: Shadow V (make shadow V=3; V=off removes it)
shadow: check-env
	@test -n "$(V)" || (echo "$(RED)✗ usage: make shadow V=<version|off>$(NC)"; exit 1)
	@cd $(CP_DIR) && node scripts/deploy.js shadow $(MODEL) $(V)

## rollback: Promote the most recently archived version
rollback: check-env
	@cd $(CP_DIR) && node scripts/deploy.js rollback $(MODEL)

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
## dev: Control plane + frontend + two serving nodes (Ctrl+C stops all)
dev: check-env
	@printf '%b\n' "$(CYAN)→ control plane :$(CP_PORT) · UI :$(FE_PORT) · nodes :$(NODE_A_PORT) :$(NODE_B_PORT)$(NC)"
	@printf '%b\n' "$(YELLOW)  open http://localhost:$(FE_PORT) — Ctrl+C to stop everything$(NC)"
	@trap 'echo "\n$(CYAN)→ stopping...$(NC)"; kill 0' INT TERM; \
		(cd $(CP_DIR) && npm run dev 2>&1 | sed -u 's/^/$(GREEN)[control]$(NC) /') & \
		(cd $(FE_DIR) && PORT=$(FE_PORT) npm run dev 2>&1 | sed -u 's/^/$(CYAN)[ui]$(NC)      /') & \
		(cd $(PY_DIR) && $(PY) -m serving --port $(NODE_A_PORT) --node-id node-a 2>&1 | sed -u 's/^/$(YELLOW)[node-a]$(NC)  /') & \
		(cd $(PY_DIR) && $(PY) -m serving --port $(NODE_B_PORT) --node-id node-b 2>&1 | sed -u 's/^/$(YELLOW)[node-b]$(NC)  /') & \
		wait

## dev-control-plane: Only the control plane (port 4030)
dev-control-plane: check-env
	@cd $(CP_DIR) && npm run dev

## dev-frontend: Only the UI (port 3030)
dev-frontend:
	@cd $(FE_DIR) && PORT=$(FE_PORT) npm run dev

## serve: Only the two serving nodes
serve: check-env
	@trap 'kill 0' INT TERM; \
		(cd $(PY_DIR) && $(PY) -m serving --port $(NODE_A_PORT) --node-id node-a 2>&1 | sed -u 's/^/[node-a] /') & \
		(cd $(PY_DIR) && $(PY) -m serving --port $(NODE_B_PORT) --node-id node-b 2>&1 | sed -u 's/^/[node-b] /') & \
		wait

## serve-one: One serving node on PORT (make serve-one PORT=8033) — grow the fleet
serve-one: check-env
	@cd $(PY_DIR) && $(PY) -m serving --port $(or $(PORT),8033) --node-id node-$(or $(PORT),8033)

## load: Traffic (RPS=10 DRIFT=0..1 NULL_FEATURE=tenure_days)
load:
	@cd $(PY_DIR) && $(PY) loadgen.py --rps $(RPS) --drift $(DRIFT) \
		--nodes http://localhost:$(NODE_A_PORT),http://localhost:$(NODE_B_PORT) \
		$(if $(NULL_FEATURE),--null-feature $(NULL_FEATURE))

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
## smoke: Offline tests — Node + Python, no cluster, no network
#
# Deliberately does NOT depend on check-env: it must run on a fresh clone.
smoke:
	@printf '%b\n' "$(CYAN)→ control plane (node)$(NC)"
	@cd $(CP_DIR) && npm run --silent smoke
	@printf '%b\n' "$(CYAN)→ serving + trainer (python)$(NC)"
	@test -x $(VENV)/bin/python || (echo "$(RED)✗ no venv — run make install first$(NC)"; exit 1)
	@cd $(PY_DIR) && $(PY) -m unittest discover -s tests -v

## e2e: Checks against your cluster, in a throwaway <db>_e2e database
e2e: check-env
	@cd $(CP_DIR) && npm run --silent e2e

# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------
## health: Curl the control plane and both nodes
health:
	@curl -fsS http://localhost:$(CP_PORT)/health >/dev/null && echo "$(GREEN)✓ control plane :$(CP_PORT)$(NC)" || echo "$(RED)✗ control plane :$(CP_PORT)$(NC)"
	@for p in $(NODE_A_PORT) $(NODE_B_PORT); do \
		curl -fsS http://localhost:$$p/health 2>/dev/null | grep -q '"ok"' && echo "$(GREEN)✓ node :$$p serving$(NC)" || echo "$(YELLOW)… node :$$p not serving$(NC)"; done

## stop: Kill processes on all lab ports
stop:
	@for p in $(CP_PORT) $(FE_PORT) $(NODE_A_PORT) $(NODE_B_PORT); do \
		lsof -ti tcp:$$p | xargs kill -9 2>/dev/null || true; done
	@printf '%b\n' "$(GREEN)✓ stopped$(NC)"

## clean: Remove node_modules, .next, the venv and caches (keeps .env)
clean:
	@rm -rf $(CP_DIR)/node_modules $(FE_DIR)/node_modules $(FE_DIR)/.next
	@rm -rf $(VENV) $(PY_DIR)/.cache $(PY_DIR)/trainer/out
	@find $(PY_DIR) -name __pycache__ -type d -prune -exec rm -rf {} +
	@printf '%b\n' "$(GREEN)✓ clean$(NC)"

# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------
check-python:
	@$(PYTHON) -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || \
		(echo "$(RED)✗ Python 3.10+ required ($(PYTHON) is $$($(PYTHON) --version)). Try: make install PYTHON=python3.12$(NC)"; exit 1)

check-env:
	@if [ ! -f .env ]; then \
		echo "$(RED)✗ .env not found. Run 'make install' first or copy .env.example$(NC)"; exit 1; fi
	@if ! grep -q "^MONGODB_URI=mongodb" .env || grep -q "USER:PASSWORD@CLUSTER" .env; then \
		echo "$(RED)✗ MONGODB_URI looks unset in .env$(NC)"; exit 1; fi
	@test -x $(VENV)/bin/python || (echo "$(RED)✗ no python venv — run make install$(NC)"; exit 1)
