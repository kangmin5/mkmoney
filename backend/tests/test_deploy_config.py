"""운영 배포 설정 검증(컨테이너를 기동하지 않고 compose 설정만 렌더링한다)."""

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).parents[2]
pytestmark = pytest.mark.skipif(shutil.which("docker") is None, reason="requires docker compose")


def render(env_file: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", "-f", str(ROOT / "compose.yaml"), "--env-file", str(env_file), "config", "--format", "json"],
        capture_output=True, text=True, check=False,
    )


@pytest.fixture(scope="module")
def config() -> dict[str, Any]:
    result = render(ROOT / ".env.example")
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)  # type: ignore[no-any-return]


def test_only_the_proxy_is_published_and_only_on_the_private_lan_ip(config: dict[str, Any]) -> None:
    services = config["services"]
    assert services["db"].get("ports") is None
    assert services["app"].get("ports") is None
    assert services["proxy"]["ports"] == [
        {"mode": "ingress", "host_ip": "192.168.0.2", "target": 443, "published": "443", "protocol": "tcp"}
    ]


def test_database_lives_on_an_internal_network(config: dict[str, Any]) -> None:
    assert config["networks"]["backend"]["internal"] is True
    assert list(config["services"]["db"]["networks"]) == ["backend"]
    assert "backend" not in config["services"]["proxy"]["networks"]


def test_app_origin_matches_domain(config: dict[str, Any]) -> None:
    assert config["services"]["app"]["environment"]["MKMONEY_ALLOWED_ORIGINS"] == "https://money.kangmin.kr"


def test_missing_bind_ip_is_refused(tmp_path: Path) -> None:
    env = tmp_path / "no-bind.env"
    env.write_text("\n".join(
        line for line in (ROOT / ".env.example").read_text().splitlines() if not line.startswith("LAN_BIND_IP=")
    ))
    result = render(env)
    assert result.returncode != 0 and "LAN_BIND_IP" in result.stderr


def test_docker_context_is_an_allowlist_that_excludes_private_data() -> None:
    lines = [line.strip() for line in (ROOT / ".dockerignore").read_text().splitlines() if line.strip() and not line.startswith("#")]
    assert lines[0] == "**"
    allowed = [line for line in lines if line.startswith("!")]
    assert not any(part in line for line in allowed for part in ("data", ".env", "pgdata", "backups"))


def test_proxy_disables_admin_and_uses_internal_tls() -> None:
    caddyfile = (ROOT / "Caddyfile").read_text()
    assert "admin off" in caddyfile and "tls internal" in caddyfile
    assert "connect-src 'self'" in caddyfile and "frame-ancestors 'none'" in caddyfile
