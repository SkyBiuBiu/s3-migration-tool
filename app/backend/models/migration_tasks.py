from core.database import Base
from datetime import datetime as PyDateTime
from typing import Optional
from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column


class Migration_tasks(Base):
    __tablename__ = "migration_tasks"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    source_prefix: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    target_prefix: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    skip_existing: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    sync_mode: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    verify: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    concurrency: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bandwidth_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    include_suffixes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    exclude_suffixes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    min_size: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_size: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    modified_after: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    modified_before: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    continuation_token: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    prefix_queue: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    listing_done: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    pending_keys: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    total_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_bytes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    done_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    skipped_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    failed_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    verified_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bytes_transferred: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bytes_copied: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    processed_bytes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    failed_items: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    logs: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    locked_until: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_run_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[Optional[PyDateTime]] = mapped_column(DateTime(timezone=True), default=PyDateTime.now)
    updated_at: Mapped[Optional[PyDateTime]] = mapped_column(DateTime(timezone=True), default=PyDateTime.now, onupdate=PyDateTime.now)