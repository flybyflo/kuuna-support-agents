from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from kuuna_backend.api.deps import get_db
from kuuna_backend.db.models import MediaAsset, Message, MessageVersion
from kuuna_backend.main import create_app


@pytest.fixture
def test_session_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Message.__table__.create(bind=engine)
    MessageVersion.__table__.create(bind=engine)
    MediaAsset.__table__.create(bind=engine)

    return sessionmaker(bind=engine, autoflush=False, autocommit=False, class_=Session)


@pytest.fixture
def client(test_session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        db = test_session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
