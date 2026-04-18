from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Sequence

DEFAULT_MODEL = "local-placeholder-model"


@dataclass(slots=True)
class FailoverPlan:
    models: list[str]
    max_hops: int = 2


def build_failover_plan(model_path: Sequence[str] | None, max_hops: int = 2) -> FailoverPlan:
    """Return a deduplicated failover plan capped at the requested hop count."""

    unique_models: list[str] = []
    for model in model_path or [DEFAULT_MODEL]:
        normalized_model = model.strip()
        if normalized_model and normalized_model not in unique_models:
            unique_models.append(normalized_model)

    if not unique_models:
        unique_models.append(DEFAULT_MODEL)

    max_attempts = max_hops + 1
    return FailoverPlan(models=unique_models[:max_attempts], max_hops=max_hops)


def iter_model_path(model_path: Sequence[str] | None, max_hops: int = 2) -> Iterator[str]:
    """Yield models in failover order, allowing at most two failover hops by default."""

    yield from build_failover_plan(model_path=model_path, max_hops=max_hops).models
