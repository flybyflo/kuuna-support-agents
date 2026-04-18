from importlib import import_module



def test_knowledge_indexing_helper_smoke(monkeypatch) -> None:
    indexing = import_module("kuuna_backend.jobs.indexing")

    chunks = indexing._chunk_markdown("# Intro\n\n" + ("word " * 80), max_chunk_chars=120)
    assert chunks
    assert all(isinstance(chunk, str) for chunk in chunks)
    assert all(len(chunk) <= 120 for chunk in chunks)

    embedding = indexing._pseudo_embedding(chunks[0], dimensions=8)
    assert len(embedding) == 8
    assert all(isinstance(value, float) for value in embedding)

    monkeypatch.setattr(indexing, "is_openai_configured", lambda: False)
    embedded_chunks = indexing._embed_chunks(["hello world"], dimensions=8)
    assert len(embedded_chunks) == 1
    assert len(embedded_chunks[0]) == 8
    assert all(isinstance(value, float) for value in embedded_chunks[0])


def test_embed_chunks_validates_dimensions(monkeypatch) -> None:
    indexing = import_module("kuuna_backend.jobs.indexing")

    monkeypatch.setattr(indexing, "is_openai_configured", lambda: True)
    monkeypatch.setattr(indexing, "create_text_embeddings", lambda _: [[0.1, 0.2]])

    try:
        indexing._embed_chunks(["hello"], dimensions=3)
    except ValueError as exc:
        assert "dimensions mismatch" in str(exc)
    else:
        raise AssertionError("expected ValueError for invalid embedding dimensions")
