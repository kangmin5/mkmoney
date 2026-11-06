"""거래 흐름 출처(auto/manual)와 가져오기 요약 건수 추가."""

import sqlalchemy as sa

from alembic import op

revision = "0002_flow_source_counts"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """기존 행은 모두 auto로 채운다(데이터 보존)."""
    op.add_column(
        "transactions",
        sa.Column("flow_source", sa.String(10), nullable=False, server_default="auto"),
    )
    op.create_check_constraint(
        "ck_transactions_flow_source", "transactions", "flow_source IN ('auto', 'manual')"
    )
    op.create_index("ix_transactions_source_type", "transactions", ["source_type"])
    for name in ("in_file_duplicate_count", "review_count", "error_count"):
        op.add_column(
            "import_batches", sa.Column(name, sa.Integer(), nullable=False, server_default="0")
        )
    op.create_index("ix_import_batches_imported_at", "import_batches", ["imported_at"])


def downgrade() -> None:
    """추가한 열·인덱스만 제거한다."""
    op.drop_index("ix_import_batches_imported_at", table_name="import_batches")
    for name in ("error_count", "review_count", "in_file_duplicate_count"):
        op.drop_column("import_batches", name)
    op.drop_index("ix_transactions_source_type", table_name="transactions")
    op.drop_constraint("ck_transactions_flow_source", "transactions", type_="check")
    op.drop_column("transactions", "flow_source")
