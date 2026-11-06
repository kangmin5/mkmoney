# mkmoney 개발·운영 단축 명령. `make` 또는 `make help` 로 목록 확인.
# 백엔드는 uv(Python 3.13), 프론트는 npm. 운영 배포는 사용자 승인 후에만 실행한다.

UV := $(HOME)/.local/bin/uv
NPM := npm
COMPOSE_DEV := docker compose -f compose.dev.yaml
COMPOSE_TEST := docker compose -f compose.test.yaml
COMPOSE_PROD := docker compose -f compose.yaml --env-file .env
# 테스트 전용 일회용 DB(이름이 _test 로 끝나야 테스트가 실행된다)
TEST_DB_URL := postgresql+psycopg://mkmoney_test:mkmoney_test_only@127.0.0.1:55432/mkmoney_test
DEV_DB_URL := postgresql+psycopg://mkmoney_dev:mkmoney_dev_only@127.0.0.1:55433/mkmoney_dev

.DEFAULT_GOAL := help
.PHONY: help dev-db dev-migrate back front test-db-up test-db-down test check version bump record \
        release deploy backup ship prod-config password-hash secret ca-cert prod-up prod-down prod-logs prod-ps

help: ## 사용 가능한 명령 목록
	@echo "mkmoney 명령어:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  make %-13s %s\n", $$1, $$2}'

# ── 개발(로컬) ───────────────────────────────────────────────
dev-db: ## 개발용 DB 기동(Docker, 127.0.0.1:55433) 후 마이그레이션
	$(COMPOSE_DEV) up -d --wait db
	$(MAKE) dev-migrate

dev-migrate: ## 개발 DB에 Alembic 마이그레이션 적용
	cd backend && MKMONEY_DATABASE_URL=$(DEV_DB_URL) $(UV) run alembic upgrade head

back: ## 백엔드 개발 서버(자동 리로드, localhost HTTP 개발 모드)
	cd backend && MKMONEY_DATABASE_URL=$(DEV_DB_URL) MKMONEY_DEV_INSECURE=true \
	  $(UV) run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

front: ## 프론트 개발 서버(Vite, /api 는 백엔드로 프록시)
	cd frontend && $(NPM) run dev

# ── 검사 ─────────────────────────────────────────────────────
test-db-up: ## 테스트 전용 일회용 DB 기동(tmpfs, 데이터 비영속)
	$(COMPOSE_TEST) up -d --wait db

test-db-down: ## 테스트 DB 중지·삭제
	$(COMPOSE_TEST) down -v

test: ## 전체 검사: 백엔드 pytest/ruff/mypy + 프론트 typecheck/vitest/build
	$(MAKE) test-db-up
	cd backend && MKMONEY_TEST_DATABASE_URL=$(TEST_DB_URL) $(UV) run pytest \
	  && $(UV) run ruff check . && $(UV) run mypy app
	cd frontend && $(NPM) run typecheck && $(NPM) test -- --run && $(NPM) run build

check: test ## (별칭) test 와 동일

# ── 버전·기록 ───────────────────────────────────────────────
version: ## 현재 버전 3곳 출력
	@echo "package.json   : $$(grep -oP '"version": "\K[0-9.]+' frontend/package.json)"
	@echo "pyproject.toml : $$(grep -oP '^version = "\K[0-9.]+' backend/pyproject.toml)"
	@echo "__init__.py    : $$(grep -oP '__version__ = "\K[0-9.]+' backend/app/__init__.py)"

bump: ## 화면 표시 버전 3곳 + lockfile 동기화 (예: make bump V=0.1.1)
	@echo "$(V)" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo 'V=x.y.z 형식 필요 (예: make bump V=0.1.1)'; exit 1; }
	@cd frontend && $(NPM) version $(V) --no-git-tag-version --allow-same-version >/dev/null
	@sed -i -E 's/^version = "[0-9][0-9.]*"/version = "$(V)"/' backend/pyproject.toml
	@sed -i -E 's/__version__ = "[0-9][0-9.]*"/__version__ = "$(V)"/' backend/app/__init__.py
	@cd backend && $(UV) lock --quiet
	@echo "버전 → $(V) (package.json·package-lock.json / pyproject.toml·uv.lock / __init__.py)"

record: ## dev_record.md에 vV 항목 한 줄 추가(이미 있으면 건너뜀)
	@test -n "$(V)" || { echo 'V=버전 필요 (예: make record V=0.1.1 MSG="요약")'; exit 1; }
	@if grep -q "^## v$(V)" dev_record.md 2>/dev/null; then \
	  echo "dev_record: v$(V) 이미 있음 — 건너뜀"; \
	else \
	  awk -v v="$(V)" -v m="$(MSG)" \
	    '{print} /^커밋마다 버전과 변경 요약을 기록한다/ && !i {print ""; print "## v" v " — " m; i=1}' \
	    dev_record.md > .devrec.tmp && mv .devrec.tmp dev_record.md && echo "dev_record: ## v$(V) 추가"; \
	fi

# ── 운영(사용자 승인 후에만) ─────────────────────────────────
deploy: ## 운영 배포(배포 전 백업→재빌드→헬스확인)
	./scripts/deploy_prod.sh

backup: ## 운영 DB 즉시 백업(롤링)
	./scripts/backup_prod_db.sh

release: ## 버전동기화→검증→기록→커밋→푸시(배포 없음) (예: make release V=0.1.1 MSG="요약")
	@echo "$(V)" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo 'V=x.y.z 형식 필요 (예: make release V=0.1.1 MSG="요약")'; exit 1; }
	@test -n "$(MSG)" || { echo 'MSG="요약" 필요'; exit 1; }
	@if git log --format=%s | grep -q "^v$(V):"; then echo "v$(V) 커밋이 이미 있음 — 버전을 올리세요"; exit 1; fi
	$(MAKE) bump V=$(V)
	$(MAKE) test
	$(MAKE) record V=$(V) MSG="$(MSG)"
	git add -A && git commit -m "v$(V): $(MSG)"
	git push -u origin HEAD
	@echo "release 완료: v$(V)"

ship: ## release + 운영 배포 (예: make ship V=0.1.1 MSG="요약")
	@test -x scripts/deploy_prod.sh || { echo 'scripts/deploy_prod.sh 없음 — 배포 준비(Task 9) 전에는 make release 사용'; exit 1; }
	$(MAKE) release V=$(V) MSG="$(MSG)"
	./scripts/deploy_prod.sh
	@echo "ship 완료: v$(V)"

prod-config: ## 운영 compose 설정 검증(기동하지 않음)
	@test -f .env || { echo '.env 없음 — cp .env.example .env 후 값을 채우세요(README 참고)'; exit 1; }
	$(COMPOSE_PROD) config --quiet && echo "compose.yaml 설정 OK"

password-hash: ## 로그인 비밀번호 Argon2id 해시 생성(.env에 붙여 넣을 한 줄 출력)
	@cd backend && $(UV) run python -m scripts.create_password_hash

secret: ## 무작위 비밀값 생성(DB 비밀번호·세션 비밀용, 영문·숫자)
	@python3 -c "import secrets; print(secrets.token_hex(32))"

ca-cert: ## Caddy 로컬 CA 루트 인증서를 ./mkmoney-local-ca.crt로 내보내기(기기 신뢰 등록용)
	$(COMPOSE_PROD) exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > mkmoney-local-ca.crt
	@openssl x509 -in mkmoney-local-ca.crt -noout -subject -enddate -fingerprint -sha256

prod-up: ## 운영 스택 기동(재빌드)
	$(COMPOSE_PROD) up -d --build

prod-down: ## 운영 스택 중지
	$(COMPOSE_PROD) down

prod-logs: ## 운영 로그 따라가기
	$(COMPOSE_PROD) logs -f

prod-ps: ## 운영 컨테이너 상태
	$(COMPOSE_PROD) ps
