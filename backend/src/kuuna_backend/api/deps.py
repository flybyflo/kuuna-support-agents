from __future__ import annotations

from collections.abc import Generator

from sqlalchemy.orm import Session

from kuuna_backend.integrations.postgres import get_db_session


def get_db() -> Generator[Session, None, None]:
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()
