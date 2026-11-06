# mkmoney MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, single-user web app that imports BankSalad ledger rows into PostgreSQL only after review, then shows monthly and custom-period cashflow, category breakdowns, and card usage on desktop and mobile.

**Architecture:** A Vite + React + TypeScript client parses `.xlsx` files locally and talks to a same-origin FastAPI JSON API. FastAPI writes approved normalized rows to PostgreSQL on the home server, serves the built frontend, and exposes summary, import, backup, and authentication endpoints; a LAN-only HTTPS reverse proxy protects browser traffic.

**Tech Stack:** Python 3.13, uv 0.11.7, FastAPI, SQLAlchemy, Alembic, PostgreSQL 17, Node.js 26.8.1, npm 11.19.0, Vite, React, TypeScript, `xlsx`, pytest, Vitest, React Testing Library, Docker Compose 5.1.1. The host has Python 3.10.12, which reached end of life on 2026-10-01; use Python 3.13 via uv/Docker and record resolved library versions in lockfiles.

**Spec:** `docs/superpowers/specs/2026-11-06-mkmoney-mvp-design.md`

## Global Constraints

- Backend: FastAPI; database: PostgreSQL; frontend: Vite + TypeScript.
- Self-host on the user's home server and keep access on the private LAN over HTTPS; do not expose public ports or create tunnels.
- Parse `.xlsx` in the browser and never upload workbook bytes or non-transaction sheets.
- Before approval, send only import fingerprints to the app API for duplicate checking; do not log fingerprints or transaction values.
- Send normalized new rows to the API only after explicit user approval.
- The only imported sheet is `가계부 내역`, with headers `날짜`, `시간`, `타입`, `대분류`, `소분류`, `내용`, `금액`, `화폐`, `결제수단`, `메모`.
- Exact duplicate identity is normalized `날짜 + 시간 + 타입 + 금액 + 화폐 + 결제수단 + 내용`; category and memo changes do not update an existing record.
- Preserve existing transactions. Imports and backup restore append only; use database uniqueness and a single transaction for each approved batch.
- Preserve original category text; unknown types and ambiguous refunds stay out of totals pending user classification.
- Map original payment-method labels to credit, debit, or other only by user choice; persist those mappings and do not infer card type from an ambiguous label.
- Exclude transfers and `대분류 = 카드대금` settlement outflows from purchase spending. Explicitly identified refunds reduce net expense and card spend and remain separately visible.
- Use fixed-precision decimal amounts, group by currency, and do not apply FX conversion.
- Use synthetic data in tests, logs, docs, and mockups; never put real ledger values or personal identifiers in them.
- Ignore the entire root `data/` directory in `.gitignore`; never add the real BankSalad workbook to Git.
- Store secrets outside source control; never log request bodies or transaction fields.
- Require a single-user login for data routes and TLS for browser-to-app traffic, including on the private LAN; bind the proxy only to an explicitly configured private LAN IP.
- PostgreSQL tests use a dedicated disposable test database/container, never an operating or shared database.
- Keep product search, recommendation, financial integrations, pension analysis, loan/savings simulation, and cloud sync out of scope.

## Review Focus

- Unsupported workbook, absent/duplicate headers, and a non-transaction sheet must give a clear local error and never select `뱅샐현황` as a ledger.
- Identical same-day rows, repeated file imports, and API retries must not create extra transactions or overwrite an existing row.
- Unknown transaction types, missing date/amount/currency, and ambiguous refund rows must remain reviewable and not distort totals.
- Transfers, card settlement outflows, explicitly mapped refunds, multiple currencies, and category totals must follow the specified accounting rules.
- Month/year/leap-day boundaries, inclusive custom ranges, previous full month, same-date comparison, and narrow mobile layouts must remain correct and usable.

---

## File Structure

- `backend/pyproject.toml`, `backend/uv.lock`: Python dependencies and lockfile.
- `backend/app/main.py`, `backend/app/config.py`: FastAPI entry point, settings, static frontend serving, and startup wiring.
- `backend/app/api/auth.py`, `backend/app/api/imports.py`, `backend/app/api/transactions.py`, `backend/app/api/reports.py`, `backend/app/api/backup.py`: same-origin API routes.
- `backend/app/db.py`, `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/repositories.py`: PostgreSQL connection, ORM entities, API contracts, and query access.
- `backend/app/services/imports.py`, `backend/app/services/reports.py`, `backend/app/services/backup.py`: transaction commit/deduplication, report calculations, and backup validation.
- `backend/alembic.ini`, `backend/alembic/`: versioned PostgreSQL schema migrations.
- `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`: frontend build and test configuration.
- `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`: app bootstrap, navigation, and responsive design tokens/styles matching `mockup.html`.
- `frontend/src/domain/transaction.ts`, `frontend/src/domain/periods.ts`, `frontend/src/domain/aggregate.ts`: shared client types, date ranges, and deterministic aggregate presentation logic.
- `frontend/src/import/workbook.ts`, `frontend/src/import/fingerprint.ts`, `frontend/src/import/preview.ts`: local workbook parsing, canonical fingerprint creation, and preview classification.
- `backend/app/services/fingerprint.py`: server-side recomputation and validation of client fingerprints on approved rows.
- `frontend/src/api/client.ts`, `frontend/src/storage/backup.ts`: same-origin API access and client-side encrypted backup file handling.
- `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/CategoriesPage.tsx`, `frontend/src/pages/CardsPage.tsx`, `frontend/src/pages/ImportPage.tsx`, `frontend/src/pages/SettingsPage.tsx`: login, dashboard, ledger, category, card, import, and mapping/backup pages.
- `frontend/src/components/PeriodControls.tsx`, `frontend/src/components/ReviewList.tsx`, `frontend/src/components/MetricCard.tsx`: reusable responsive controls and display components.
- `compose.yaml`, `backend/Dockerfile`, `Caddyfile`, `.env.example`, `.gitignore`, `README.md`: app/database/private HTTPS proxy deployment, environment template, secret exclusion, and usage/privacy documentation.
- `backend/tests/` and `frontend/src/**/*.test.*`: isolated backend and synthetic-data frontend tests.

## Task 1: Scaffold the Full-Stack Shell

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/main.py`, `backend/app/config.py`, `backend/tests/test_health.py`
- Create: `frontend/package.json`, `frontend/package-lock.json`, `frontend/index.html`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/App.test.tsx`
- Modify: `.gitignore` (already excludes `/data/`; extend with build/cache/env patterns without removing that rule)

**Interfaces:**
- `GET /api/health` returns `{ "status": "ok" }` without database or user data.
- `App` renders navigation named `자금 현황`, `거래내역`, `분류`, `카드 사용`, `가져오기`, and `설정` plus a dashboard heading.
- Development uses Vite proxying `/api` to FastAPI; production FastAPI serves `frontend/dist` from the same origin.

- [ ] **Step 1: Write failing shell and health tests**

Create `backend/tests/test_health.py` asserting the health response and `frontend/src/App.test.tsx` asserting the named heading and navigation.

- [ ] **Step 2: Run the tests and confirm they fail**

Run from `backend/`: `uv run pytest tests/test_health.py -q`
Expected: FAIL because the API route is absent.

Run from `frontend/`: `npm test -- --run src/App.test.tsx`
Expected: FAIL because the app shell is absent.

- [ ] **Step 3: Add the minimal FastAPI and Vite/React shells**

Use Python 3.13 (provisioned with uv or Docker) and current host Node/npm. Keep the health route independent of PostgreSQL. The React shell must contain no financial sample values or external asset requests.

- [ ] **Step 4: Run shell tests and build**

Run `uv run pytest tests/test_health.py -q` from `backend/` and `npm test -- --run src/App.test.tsx` plus `npm run build` from `frontend/`.
Expected: both tests pass and Vite creates `frontend/dist/`.

## Task 2: Define PostgreSQL Models and Migrations

**Files:**
- Create: `backend/app/db.py`, `backend/app/models.py`, `backend/app/schemas.py`, `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/versions/0001_initial.py`
- Create: `backend/tests/test_models.py`, `backend/tests/test_migrations.py`, `compose.test.yaml`

**Interfaces:**
- `Transaction` stores UUID, date, nullable local time, source type, flow (`income`, `expense`, `transfer`, `refund`, `needs_review`), original major/minor categories, description, signed source `NUMERIC(20,4)` amount, currency, payment method, memo, canonical fingerprint, and created timestamp. Aggregates use the absolute amount with direction from the explicit flow mapping.
- `TransactionTypeMapping` stores one exact source type to one explicit flow mapping; future imports reuse it.
- `PaymentMethodMapping` stores one exact source payment-method label to `credit`, `debit`, or `other`; future reports reuse it.
- `ImportBatch` stores import time and counts only; it must not store transaction row contents.
- Unique constraint on `Transaction.fingerprint` prevents duplicate inserts. No ORM relationship cascades may delete or replace existing transaction rows during import.
- `TransactionCreate` and report response schemas validate values and never expose database secrets.

- [ ] **Step 1: Write failing model and migration tests**

Test decimal precision, required fields, allowed flow values, unique fingerprint behavior, transaction-type/payment-method mapping persistence, and migration up/down on a dedicated disposable PostgreSQL test service.

- [ ] **Step 2: Run tests to confirm failure**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit`
Expected: FAIL because model and migration files do not exist; the test service has no host data volume.

- [ ] **Step 3: Implement SQLAlchemy models and Alembic migration**

Use a PostgreSQL-specific integration database. Keep the test DB URL separate from development/runtime settings; refuse test setup if it points to a non-test database.

- [ ] **Step 4: Run the model and migration tests**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit`
Expected: PASS; schema migration and unique/decimal assertions pass against the disposable PostgreSQL service.

## Task 3: Parse the Workbook and Build Duplicate Preview Data

**Files:**
- Create: `frontend/src/import/workbook.ts`, `frontend/src/import/fingerprint.ts`, `frontend/src/import/preview.ts`
- Test: `frontend/src/import/workbook.test.ts`, `frontend/src/import/fingerprint.test.ts`, `frontend/src/import/preview.test.ts`

**Interfaces:**
- `parseWorkbook(file: File): Promise<ParsedWorkbook>` parses in the browser and selects only `가계부 내역` by header names; it never calls `fetch` or sends workbook bytes.
- `ParsedRow` contains source row index, raw fields, parsed ISO local date/time, fixed-decimal amount string, currency, normalized flow or `needs_review`, and non-sensitive validation codes.
- `createFingerprint(row: ParsedRow): string` hashes the normalized tuple `date, time, source type, amount, currency, payment method, description` in that order; category and memo are excluded.
- `buildPreview(parsedRows, existingFingerprints)` distinguishes new rows, existing duplicates, duplicates within the workbook, and rows requiring review.

- [ ] **Step 1: Write failing tests with generated synthetic workbooks**

Cover header-order changes, workbook with `뱅샐현황` before the transaction sheet, missing/duplicate required headers, Excel serial and text dates, blank rows, invalid amount/currency, unknown source type, file-internal duplicates, and fingerprint normalization. Use generated workbook bytes with synthetic values only.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npm test -- --run src/import`
Expected: FAIL because the parser and preview functions are absent.

- [ ] **Step 3: Implement local parsing and pure preview functions**

Use the locked `xlsx` parser dependency. Do not select customer or summary sheets. Return row-numbered validation codes without embedding row values in thrown errors or logs. Use exact decimal strings; do not parse financial amounts through binary float.

- [ ] **Step 4: Run import unit tests**

Run: `npm test -- --run src/import`
Expected: PASS, including confirmation that parsing makes no network calls.

## Task 4: Add Authentication and Transactional Import API

**Files:**
- Create: `backend/app/api/auth.py`, `backend/app/api/imports.py`, `backend/app/repositories.py`, `backend/app/services/imports.py`
- Create: `backend/app/services/fingerprint.py`
- Create: `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/LoginPage.test.tsx`
- Modify: `backend/app/main.py`, `backend/app/config.py`, `backend/app/schemas.py`, `frontend/src/App.tsx`, `frontend/src/api/client.ts`
- Test: `backend/tests/test_auth.py`, `backend/tests/test_import_api.py`, `backend/tests/test_import_service.py`

**Interfaces:**
- `POST /api/auth/login` validates the single configured app credential and sets a signed HttpOnly SameSite session cookie; `POST /api/auth/logout` clears it. All data endpoints require a valid session.
- Mutating routes require HTTPS, a same-origin `Origin` header, and a `Secure`, HttpOnly, SameSite=Strict session cookie.
- `GET /api/auth/me` returns only whether the current browser session is authenticated.
- `LoginPage` submits the password over HTTPS, stores no credential in local storage, and displays no financial data until `/api/auth/me` confirms the session.
- `POST /api/imports/check` accepts `{ "fingerprints": string[] }` and returns which fingerprints already exist. It never accepts or logs financial fields.
- `POST /api/imports` accepts `{ "file_name": string, "rows": TransactionCreate[] }` after client approval and returns counts `{ inserted, duplicate, batch_id }`.
- `GET /api/imports/recent` returns only timestamp and aggregate import counts for the dashboard.
- `commit_import(rows, file_name) -> ImportResult` inserts only new rows and an import count summary in one DB transaction. A duplicate fingerprint is skipped, never updated. Any other row failure rolls back the full batch.
- `fingerprint_transaction(row: TransactionCreate) -> str` applies the same canonical field normalization and SHA-256 encoding as the browser; commit rejects a mismatched client fingerprint.
- `GET /api/type-mappings` and `PUT /api/type-mappings` read/write exact raw-type to flow mappings.
- `GET /api/payment-method-mappings` and `PUT /api/payment-method-mappings` read/write exact raw payment-method to card-kind mappings.

- [ ] **Step 1: Write failing auth and import tests**

Test unauthenticated requests are rejected; cookie flags and logout are correct; login page does not persist credentials; fingerprints return duplicate status without accepting row payloads; approved inserts persist; repeated requests create no duplicates; type and payment-method mappings persist; validation/DB failure leaves no partial batch; and captured logs contain no request data.

- [ ] **Step 2: Run API tests and confirm failure**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit`
Expected: FAIL because auth/import routes and service are absent.

- [ ] **Step 3: Implement session auth and transactional endpoints**

Read password hash and session signing secret from environment configuration only. Configure request-body logging off for import routes. Use the database unique constraint as the final retry/concurrency guard.

- [ ] **Step 4: Run API and service tests**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit`
Expected: PASS against the disposable test database.

## Task 5: Implement Reporting and Aggregation APIs

**Files:**
- Create: `backend/app/api/reports.py`, `backend/app/services/reports.py`
- Modify: `backend/app/main.py`, `backend/app/schemas.py`
- Test: `backend/tests/test_reports.py`

**Interfaces:**
- `GET /api/reports/summary?start=YYYY-MM-DD&end=YYYY-MM-DD&comparison=previous_month|same_range` returns per-currency income, gross expense, refunds, net expense, net cashflow, comparison deltas, and unresolved count.
- `GET /api/reports/categories?start=...&end=...&flow=income|expense|refund` groups by original major/minor category and currency.
- `GET /api/reports/cards?start=...&end=...` groups actual purchase expenses and refunds by exact payment method; card settlement rows are excluded.
- `GET /api/transactions?start=...&end=...&category=...` returns paginated rows for the local transaction detail view and requires an authenticated session.
- Report period endpoints are inclusive local calendar dates. A custom range comparison uses the immediately preceding range of the same number of calendar days.
- `transfer` and `needs_review` are excluded from income/expense totals. `major_category == "카드대금"` settlement outflows are excluded from purchase and card-spend totals. A mapped `refund` reduces net expense/card usage and is returned as a separate subtotal.

- [ ] **Step 1: Write failing report tests**

Use synthetic rows to test monthly/custom periods, prior full month and same-date comparison, year/leap-day boundaries, inclusive endpoints, category grouping, two currencies without conversion, signed source amounts, transfer/card settlement exclusion, refund subtraction, and unresolved counts. Aggregation uses absolute amount magnitude with classification as direction, while the original sign remains stored for identity/audit display.

- [ ] **Step 2: Run tests and confirm failure**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit`
Expected: FAIL because report service and endpoints are absent.

- [ ] **Step 3: Implement parameterized aggregation queries**

Use SQL `NUMERIC` aggregation and validated date parameters. Never combine currencies or infer unknown flow mappings.

- [ ] **Step 4: Run report tests**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit`
Expected: PASS with all sums and comparison deltas matching synthetic expected values.

## Task 6: Build Responsive Dashboard, Category, and Card Views

**Files:**
- Create: `frontend/src/api/client.ts`, `frontend/src/domain/periods.ts`, `frontend/src/domain/aggregate.ts`
- Create: `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/TransactionsPage.tsx`, `frontend/src/pages/CategoriesPage.tsx`, `frontend/src/pages/CardsPage.tsx`
- Create: `frontend/src/components/PeriodControls.tsx`, `frontend/src/components/MetricCard.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`
- Test: `frontend/src/pages/DashboardPage.test.tsx`, `frontend/src/pages/TransactionsPage.test.tsx`, `frontend/src/pages/CategoriesPage.test.tsx`, `frontend/src/pages/CardsPage.test.tsx`

**Interfaces:**
- `getSummary(period)` calls the same-origin report API and returns currency-separated totals and deltas.
- `getTransactions(period, filters, page)` calls the authenticated paginated ledger endpoint; the page shows original date/type/categories/description/amount/payment method without changing stored source values.
- Dashboard displays income, gross/net expense with refunds visible, net cashflow, comparison period, monthly flow, category summary, and latest import counts.
- Category view filters date range and income/expense and groups the original major/minor categories without renaming them.
- Card view uses saved payment-method mappings to group by credit/debit and preserves the original label in detail. `other` is excluded from card totals; unmapped labels remain visible as “분류 필요” while their purchase expense remains in cashflow.

- [ ] **Step 1: Write failing page tests with synthetic API responses**

Assert KPI labels and comparison mode, paginated transaction filters, currency separation, category rows, credit/debit card grouping and refund totals, loading/error/empty states, and no transaction values in dashboard logs.

- [ ] **Step 2: Run page tests and confirm failure**

Run: `npm test -- --run src/pages`
Expected: FAIL because the views and API client are absent.

- [ ] **Step 3: Implement desktop and mobile views from `mockup.html`**

Preserve the cream/navy design direction. At narrow width, use card/list layouts, touch-sized controls, and no page-level horizontal scrolling. Do not use real workbook values.

- [ ] **Step 4: Run page tests and frontend build**

Run: `npm test -- --run src/pages` and `npm run build`.
Expected: PASS; dashboard, ledger, categories, and card views render responsively.

## Task 7: Build Import Review and Type Mapping UI

**Files:**
- Create: `frontend/src/pages/ImportPage.tsx`, `frontend/src/components/ReviewList.tsx`, `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/api/client.ts`
- Test: `frontend/src/pages/ImportPage.test.tsx`, `frontend/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Import flow is `select file -> parse locally -> send fingerprints for duplicate check -> review rows -> explicit approve -> POST only new normalized rows`.
- Review rows expose date, type/category, description, amount, currency, payment method, validation state, duplicate status, and refund classification where needed.
- Unknown source types offer `income`, `expense`, `transfer`, `refund`, or unresolved; saved mappings apply to later imports. Settings also maps original payment-method labels to credit/debit/other without inferring.
- Exact duplicates default to skip and cannot modify old rows. The UI distinguishes existing duplicates from within-file duplicates.
- The final confirmation states inserted/duplicate/review counts. On API error, show failure without claiming rows were saved.

- [ ] **Step 1: Write failing import UI tests**

Assert the selected sheet is named, duplicate fingerprint check sends no row contents, review happens before commit, only approved new rows reach `POST /api/imports`, existing duplicates never become updates, type and payment-method mappings save for later imports, and validation issues are clear.

- [ ] **Step 2: Run import page tests and confirm failure**

Run: `npm test -- --run src/pages/ImportPage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: FAIL because review and mapping screens are absent.

- [ ] **Step 3: Implement review, approval, and mapping screens**

Use semantic controls and keyboard/touch interaction. On mobile render each transaction as a readable card; avoid a shrunk desktop table.

- [ ] **Step 4: Run import UI tests and build**

Run the same Vitest command and `npm run build`.
Expected: PASS; preview cannot write until approval.

## Task 8: Add Encrypted Backup and Safe Merge Restore

**Files:**
- Create: `frontend/src/storage/backup.ts`, `backend/app/api/backup.py`, `backend/app/services/backup.py`
- Modify: `backend/app/main.py`, `frontend/src/api/client.ts`, `frontend/src/pages/SettingsPage.tsx`
- Test: `frontend/src/storage/backup.test.ts`, `backend/tests/test_backup_api.py`, `frontend/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- `encryptBackup(payload, passphrase): Promise<Blob>` returns a versioned AES-GCM encrypted backup; the passphrase stays in browser memory.
- `decryptBackup(file, passphrase): Promise<BackupPayload>` validates authentication tag and payload schema before returning data.
- `GET /api/backup/export` returns normalized transactions and transaction-type/payment-method mappings only to an authenticated same-origin client; frontend encrypts before download.
- Restore decrypts in browser, checks fingerprints, shows new/duplicate counts, and commits new rows through the existing approved import API. No replace/delete operation exists.

- [ ] **Step 1: Write failing backup tests**

Test round trip, wrong passphrase, tampered/unsupported backup, malformed payload, merge-only restore, duplicate skip, and preservation of existing DB rows.

- [ ] **Step 2: Run backup tests and confirm failure**

Run: `npm test -- --run src/storage/backup.test.ts` and the backend backup test in the disposable PostgreSQL suite.
Expected: FAIL because backup functions/routes are absent.

- [ ] **Step 3: Implement client-side encryption and authenticated export**

Use Web Crypto AES-GCM-256 with a fresh 12-byte nonce and PBKDF2-HMAC-SHA-256 with 600,000 iterations and a fresh 16-byte salt. Never log backup payloads or passphrases. Restore must re-enter import preview/approval.

- [ ] **Step 4: Run backup tests**

Run both frontend backup tests and backend disposable DB tests.
Expected: PASS; wrong password or malformed restore leaves current data unchanged.

## Task 9: Package and Document Private LAN Deployment

**Files:**
- Create: `backend/Dockerfile`, `compose.yaml`, `Caddyfile`, `.env.example`, `backend/scripts/create_password_hash.py`, `README.md`, `backend/tests/test_static_app.py`, `frontend/src/privacy.test.ts`
- Modify: `backend/app/config.py`, `backend/app/main.py`, `frontend/vite.config.ts`, `.gitignore`

**Interfaces:**
- `docker compose up -d --build` runs the app, PostgreSQL, and LAN HTTPS reverse proxy on private Docker networks; PostgreSQL and FastAPI are not published to the LAN.
- Caddy binds a configured private LAN IP and HTTPS port, and uses either an existing private certificate or a local CA certificate trusted by user devices. Public port forwarding/tunnels are not part of setup.
- `create_password_hash.py` generates an Argon2id password hash for an environment file without printing or saving the plaintext password.
- Production FastAPI serves the built Vite assets and `/api/*` from one origin. Runtime config contains only secrets supplied outside version control.
- README explains local setup, LAN URL, password hash creation, HTTPS certificate trust on user devices, encrypted backup, restore merge behavior, data location, and no public exposure.

- [ ] **Step 1: Write failing static/privacy integration tests**

Test Vite assets are served by FastAPI, protected API routes require authentication, static frontend causes no third-party requests, import checks carry fingerprints but no row payload, transaction logs are redacted, and Compose does not publish PostgreSQL or bind FastAPI directly to the LAN.

- [ ] **Step 2: Run the integration tests and confirm failure**

Run: `docker compose -f compose.test.yaml up --build --abort-on-container-exit` and `npm test -- --run src/privacy.test.ts`.
Expected: FAIL until app packaging and privacy integration are implemented.

- [ ] **Step 3: Add private Compose deployment and operator documentation**

Use a pinned PostgreSQL 17 image, a named persistent volume, health checks, and no host port for PostgreSQL or FastAPI. Require `LAN_BIND_IP` with no wildcard default and bind Caddy on that private address only. Document trusting its local CA on clients if no existing private TLS proxy is available. Do not publish or start the app on the home server during implementation without explicit deployment approval.

- [ ] **Step 4: Run full verification**

Run from `backend/`: `uv run pytest -q` against the disposable test DB.
Run from `frontend/`: `npm test -- --run` and `npm run build`.
Run: `docker compose config --quiet` to validate deployment syntax without starting services.
Expected: all checks pass; no tests access production/shared data.

## Self-Review

- Spec coverage: parsing, sheet/headers, fingerprint duplicate checks, append-only approval, persisted transaction-type and payment-method mappings, transfer/card settlement/refund rules, month/custom periods, comparison modes, multi-currency separation, category/card views, mobile layout, encrypted backup merge restore, authenticated TLS access, and LAN-only deployment are each assigned above.
- Interfaces align: browser parser returns normalized preview candidates; fingerprint check returns only existing identities; commit API inserts only approved rows; report services read persisted normalized rows; backup restore reuses import preview/commit.
- The first-run shell has no fake transaction data. Generated workbook and API tests use only synthetic values.
- `.gitignore` excludes `/data/`; the real workbook is never part of implementation fixtures or Git changes.
- PostgreSQL-dependent tests run only in a disposable test container; Compose test service has no persistent data volume.
- A real-workbook manual import, exposure on the home server, and changes to the running home-server network are excluded from implementation verification until separately approved.
- No git metadata is available in the current workspace mount, so this plan does not include branch creation or commits.
