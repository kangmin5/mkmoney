"""FastAPI 진입점: JSON API와(빌드된 경우) 같은 출처의 정적 프론트엔드를 제공한다."""

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import auth, backup, imports, mappings, reports, transactions
from app.config import settings
from app.security import enforce_transport


def create_app() -> FastAPI:
    """앱을 조립한다. 문서 UI는 끈다(단일 사용자 사설 앱)."""
    application = FastAPI(
        title="mkmoney", version=__version__, docs_url=None, redoc_url=None, openapi_url=None
    )

    @application.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        # 기본 핸들러는 입력값(input)을 되돌려주므로, 위치와 오류 종류만 반환한다.
        detail = [{"loc": e.get("loc"), "type": e.get("type")} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": detail})

    @application.get("/api/health")
    def health() -> dict[str, str]:
        """DB·사용자 데이터 없이 살아있음과 서버 버전만 알린다."""
        return {"status": "ok", "version": __version__}

    guarded = [Depends(enforce_transport)]
    for router in (
        auth.router,
        backup.router,
        imports.router,
        mappings.router,
        reports.router,
        transactions.router,
    ):
        application.include_router(router, dependencies=guarded)

    if settings.frontend_dist.is_dir():
        application.mount(
            "/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend"
        )
    return application


app = create_app()
