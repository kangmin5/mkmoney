import re
import tomllib
from pathlib import Path

from fastapi.testclient import TestClient

from app import __version__
from app.main import app


def test_health_endpoint_returns_ok_and_version_without_database_access() -> None:
    assert TestClient(app).get("/api/health").json() == {"status": "ok", "version": __version__}


def test_display_versions_are_in_sync() -> None:
    """화면 표시 버전 3곳(package.json·pyproject.toml·__init__.py)이 같아야 한다."""
    root = Path(__file__).parents[2]
    pyproject = tomllib.loads((root / "backend" / "pyproject.toml").read_text())["project"]["version"]
    package = re.search(r'"version":\s*"([^"]+)"', (root / "frontend" / "package.json").read_text())
    assert package is not None
    assert re.fullmatch(r"\d+\.\d+\.\d+", __version__)
    assert __version__ == pyproject == package.group(1)
