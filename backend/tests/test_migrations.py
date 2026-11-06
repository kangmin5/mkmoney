import os
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import make_url

from alembic import command


@pytest.mark.skipif(not os.getenv("MKMONEY_TEST_DATABASE_URL"), reason="requires disposable PostgreSQL test database")
def test_migration_up_and_down_on_explicit_test_database() -> None:
    url = os.environ["MKMONEY_TEST_DATABASE_URL"]
    database = make_url(url).database or ""
    if not database.endswith("_test"):
        pytest.fail("MKMONEY_TEST_DATABASE_URL must target a database ending in _test")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")
    engine = create_engine(url)
    assert {"transactions", "import_batches", "payment_method_mappings"} <= set(inspect(engine).get_table_names())
    command.downgrade(config, "base")
    assert "transactions" not in inspect(engine).get_table_names()
    # 다른 테스트가 쓰는 스키마를 복구한다.
    command.upgrade(config, "head")
    engine.dispose()
