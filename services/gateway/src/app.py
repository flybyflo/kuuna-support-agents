from __future__ import annotations

import logging
import os

from neonize_bridge import run_neonize_gateway


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def main() -> None:
    _configure_logging()

    run_neonize_gateway(
        session_name=os.getenv("GATEWAY_SESSION_NAME", "kuuna-gateway"),
        backend_base_url=os.getenv("BACKEND_BASE_URL", "http://backend:8000"),
        service_token=os.getenv("GATEWAY_SERVICE_TOKEN"),
        database_path=os.getenv("NEONIZE_DATABASE_PATH", "./neonize.db"),
    )


if __name__ == "__main__":
    main()
