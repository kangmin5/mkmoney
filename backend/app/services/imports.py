"""승인된 가져오기 반영. 신규 행만 한 트랜잭션으로 추가하고 기존 행은 절대 수정하지 않는다."""

from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import ImportBatch, Transaction
from app.schemas import ImportRequest, ImportResult, TransactionCreate
from app.services.fingerprint import compute_fingerprint
from app.services.flow import derive_flow
from app.services.mappings import load_type_mappings


class ImportValidationError(ValueError):
    """행 값이 들어가지 않는 가져오기 검증 오류."""


def fingerprint_of(row: TransactionCreate) -> str:
    """브라우저와 같은 규칙으로 서버에서 지문을 다시 계산한다."""
    return compute_fingerprint(
        tx_date=row.date,
        tx_time=row.time,
        source_type=row.source_type,
        amount=row.amount,
        currency=row.currency,
        payment_method=row.payment_method,
        description=row.description,
    )


def existing_fingerprints(session: Session, fingerprints: Sequence[str]) -> list[str]:
    """이미 저장된 지문만 돌려준다(입력 순서 무관, 중복 제거)."""
    unique = list(dict.fromkeys(fingerprints))
    found: set[str] = set()
    for start in range(0, len(unique), 1000):
        chunk = unique[start : start + 1000]
        found.update(
            session.scalars(select(Transaction.fingerprint).where(Transaction.fingerprint.in_(chunk)))
        )
    return [f for f in unique if f in found]


def commit_import(session: Session, request: ImportRequest) -> ImportResult:
    """
    승인된 행을 한 트랜잭션으로 추가한다.
    - 지문 불일치가 하나라도 있으면 전체를 거부한다(부분 반영 없음).
    - 같은 지문은 DB unique 제약(ON CONFLICT DO NOTHING)으로 건너뛴다. 기존 행은 갱신하지 않는다.
    - 흐름이 타입 매핑 결과와 같으면 auto, 다르면 사용자가 검토에서 지정한 manual로 기록한다.
    """
    for index, row in enumerate(request.rows):
        if fingerprint_of(row) != row.fingerprint:
            # 행 번호만 알리고 값은 포함하지 않는다.
            raise ImportValidationError(f"{index + 1}번째 행의 지문이 일치하지 않습니다.")

    mappings = load_type_mappings(session)
    values = [
        {
            "id": uuid4(),
            **row.model_dump(),
            "flow_source": (
                "auto" if derive_flow(row.source_type, row.amount, mappings) == row.flow else "manual"
            ),
        }
        for row in request.rows
    ]
    try:
        inserted = 0
        for start in range(0, len(values), 1000):
            statement = (
                insert(Transaction)
                .values(values[start : start + 1000])
                .on_conflict_do_nothing(index_elements=["fingerprint"])
                .returning(Transaction.id)
            )
            inserted += len(session.execute(statement).all())
        batch = ImportBatch(
            file_name=request.file_name,
            inserted_count=inserted,
            duplicate_count=len(values) - inserted,
            in_file_duplicate_count=request.summary.in_file_duplicate,
            review_count=request.summary.review,
            error_count=request.summary.error,
        )
        session.add(batch)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return ImportResult(batch_id=batch.id, inserted=inserted, duplicate=len(values) - inserted)
