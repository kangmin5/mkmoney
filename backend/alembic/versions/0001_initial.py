"""Create initial finance schema."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("time", sa.Time(), nullable=True),
        sa.Column("source_type", sa.String(120), nullable=False),
        sa.Column("flow", sa.String(20), nullable=False),
        sa.Column("major_category", sa.String(120)),
        sa.Column("minor_category", sa.String(120)),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("amount", sa.Numeric(20, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("payment_method", sa.String(200), nullable=False),
        sa.Column("memo", sa.String(1000)),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("fingerprint", name="uq_transactions_fingerprint"),
        sa.CheckConstraint("flow IN ('income', 'expense', 'transfer', 'refund', 'needs_review')",
                           name="ck_transactions_flow"),
    )
    op.create_index("ix_transactions_date", "transactions", ["date"])
    op.create_table(
        "transaction_type_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_type", sa.String(120), nullable=False, unique=True),
        sa.Column("flow", sa.String(20), nullable=False),
        sa.CheckConstraint("flow IN ('income', 'expense', 'transfer', 'refund', 'needs_review')",
                           name="ck_type_mapping_flow"),
    )
    op.create_table(
        "payment_method_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_label", sa.String(200), nullable=False, unique=True),
        sa.Column("card_kind", sa.String(10), nullable=False),
        sa.CheckConstraint("card_kind IN ('credit', 'debit', 'other')", name="ck_payment_card_kind"),
    )
    op.create_table(
        "import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("inserted_count", sa.Integer(), nullable=False),
        sa.Column("duplicate_count", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("import_batches")
    op.drop_table("payment_method_mappings")
    op.drop_table("transaction_type_mappings")
    op.drop_index("ix_transactions_date", table_name="transactions")
    op.drop_table("transactions")
