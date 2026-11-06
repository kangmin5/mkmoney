from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import PaymentMethodMapping, Transaction, TransactionTypeMapping
from tests.conftest import TABLES, make_row


def seed(client: TestClient) -> None:
    rows = [make_row(), make_row(time="13:00:00", amount="5000", flow="refund"), make_row(source_type="합성타입", flow="needs_review", time="14:00:00")]
    assert client.post("/api/imports", json={"file_name": "x.xlsx", "rows": rows}).status_code == 201
    client.put("/api/payment-method-mappings", json={"source_label": "합성카드", "card_kind": "credit"})
    client.put("/api/type-mappings", json={"source_type": "합성타입", "flow": "transfer"})


def restore(client: TestClient, payload: dict[str, Any], rows: list[dict[str, Any]] | None = None) -> Any:
    body = {
        "file_name": "백업 복원",
        "rows": payload["transactions"] if rows is None else rows,
        "type_mappings": payload["type_mappings"],
        "payment_mappings": payload["payment_mappings"],
    }
    return client.post("/api/backup/restore", json=body)


def test_export_requires_login_and_is_not_cached(client: TestClient) -> None:
    assert client.get("/api/backup/export").status_code == 401


def test_export_contains_rows_and_user_mappings(authed: TestClient) -> None:
    seed(authed)
    response = authed.get("/api/backup/export")
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert (payload["format"], payload["version"]) == ("mkmoney-backup", 1)
    assert len(payload["transactions"]) == 3
    assert {t["flow"] for t in payload["transactions"]} == {"expense", "refund", "transfer"}
    assert payload["type_mappings"] == [{"source_type": "합성타입", "flow": "transfer"}]
    assert payload["payment_mappings"] == [{"source_label": "합성카드", "card_kind": "credit"}]


def test_round_trip_into_empty_database_restores_everything(authed: TestClient, db: Session) -> None:
    seed(authed)
    payload = authed.get("/api/backup/export").json()
    db.execute(text(f"TRUNCATE {TABLES}"))
    db.commit()
    result = restore(authed, payload).json()
    assert (result["inserted"], result["duplicate"], result["type_mappings_added"], result["payment_mappings_added"]) == (3, 0, 1, 1)
    assert authed.get("/api/backup/export").json()["transactions"] == payload["transactions"]
    sources = dict(db.execute(select(Transaction.flow, Transaction.flow_source)).all())
    assert sources == {"expense": "auto", "refund": "manual", "transfer": "auto"}


def test_restore_merges_without_overwriting_rows_or_mappings(authed: TestClient, db: Session) -> None:
    seed(authed)
    payload = authed.get("/api/backup/export").json()
    changed = [{**t, "major_category": "백업의 다른 분류"} for t in payload["transactions"]]
    new_row = make_row(time="20:00:00", description="백업에만 있는 거래")
    payload["type_mappings"] = [{"source_type": "합성타입", "flow": "income"}, {"source_type": "새타입", "flow": "expense"}]
    payload["payment_mappings"] = [{"source_label": "합성카드", "card_kind": "debit"}]
    result = restore(authed, payload, rows=[*changed, new_row]).json()
    assert (result["inserted"], result["duplicate"], result["type_mappings_added"], result["payment_mappings_added"]) == (1, 3, 1, 0)
    assert db.scalar(select(func.count()).select_from(Transaction).where(Transaction.major_category == "백업의 다른 분류")) == 0
    assert db.scalar(select(TransactionTypeMapping.flow).where(TransactionTypeMapping.source_type == "합성타입")) == "transfer"
    assert db.scalar(select(PaymentMethodMapping.card_kind)) == "credit"


def test_restore_is_atomic_on_tampered_rows(authed: TestClient, db: Session) -> None:
    seed(authed)
    payload = authed.get("/api/backup/export").json()
    tampered = {**make_row(time="21:00:00"), "amount": "-1"}
    payload["type_mappings"] = [{"source_type": "새타입", "flow": "expense"}]
    response = restore(authed, payload, rows=[make_row(time="22:00:00"), tampered])
    assert response.status_code == 422
    assert db.scalar(select(func.count()).select_from(Transaction)) == 3
    assert db.scalar(select(func.count()).select_from(TransactionTypeMapping)) == 1
