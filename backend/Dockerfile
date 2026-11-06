# mkmoney 앱 이미지: 프론트 빌드 + FastAPI. 빌드 컨텍스트는 저장소 루트(.dockerignore는 허용 목록 방식).
FROM node:24-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY --from=frontend /src/frontend/dist /app/frontend/dist
RUN useradd --system --uid 10001 --no-create-home mkmoney
USER mkmoney
ENV PATH=/opt/venv/bin:$PATH \
    MKMONEY_FRONTEND_DIST=/app/frontend/dist
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
# 시작 시 마이그레이션(추가만 하는 스키마 변경) 후 실행. 요청 본문·접근 로그는 남기지 않는다.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
