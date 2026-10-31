"""ORM models (§16)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    """Stable identifier for plan items (§8.3)."""
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    """A registered account.

    `email` is stored already lower-cased by the service layer, so the unique
    index doubles as case-insensitive uniqueness without needing CITEXT (which
    SQLite, used for local development and tests, does not have).
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    # Self-describing digest: "scrypt$n$r$p$salt_b64$hash_b64". Keeping the
    # parameters alongside the hash means the work factor can be raised later
    # and existing hashes still verify against their original settings.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    sessions: Mapped[list[Session]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Session(Base):
    """A logged-in session, identified by a token the client holds.

    Only the SHA-256 of the token is stored. A database leak therefore yields
    no usable sessions, and because the row exists server-side, signing out
    revokes access immediately — which a self-contained JWT cannot do.
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # Nullable so the column can be added to a table that already has rows.
    # Pre-authentication events keep NULL and match no owner filter, which
    # takes them out of circulation rather than handing them to whoever asks.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, default=None
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    event_name: Mapped[str | None] = mapped_column(String(160))
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    budget: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")
    guest_count: Mapped[int] = mapped_column(Integer, nullable=False)
    location: Mapped[str] = mapped_column(String(240), nullable=False)
    theme: Mapped[str | None] = mapped_column(String(120))
    preferences: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Plan-level context produced by the generation pipeline.
    assumptions: Mapped[list[str]] = mapped_column(JSON, default=list)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    emergency_reserve: Mapped[float] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )
    # The optional free-text requirements, keyed by field name, plus the
    # "was_rescaled" flag. Schemaless on purpose: a new optional requirement
    # should not need a migration.
    extra_inputs: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )

    budget_items: Mapped[list[BudgetItem]] = relationship(
        back_populates="event", cascade="all, delete-orphan", lazy="selectin"
    )
    timeline_items: Mapped[list[TimelineItem]] = relationship(
        back_populates="event", cascade="all, delete-orphan", lazy="selectin"
    )
    checklist_items: Mapped[list[ChecklistItem]] = relationship(
        back_populates="event", cascade="all, delete-orphan", lazy="selectin"
    )
    ideas: Mapped[list[PersonalizedIdea]] = relationship(
        back_populates="event", cascade="all, delete-orphan", lazy="selectin"
    )


class BudgetItem(Base):
    __tablename__ = "budget_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    estimated_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_reserve: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped[Event] = relationship(back_populates="budget_items")


class TimelineItem(Base):
    __tablename__ = "timeline_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_follow_up: Mapped[bool] = mapped_column(Boolean, default=False)

    event: Mapped[Event] = relationship(back_populates="timeline_items")


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped[Event] = relationship(back_populates="checklist_items")


class PersonalizedIdea(Base):
    __tablename__ = "personalized_ideas"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    estimated_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped[Event] = relationship(back_populates="ideas")
