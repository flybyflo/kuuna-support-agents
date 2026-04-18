from fastapi import FastAPI

from kuuna_backend.api.routers import (
    audit,
    auth,
    bindings,
    knowledge,
    messages,
    templates,
    users,
)


def create_app() -> FastAPI:
    app = FastAPI(title="Kuuna Backend", version="0.1.0")

    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(templates.router)
    app.include_router(bindings.router)
    app.include_router(messages.router)
    app.include_router(knowledge.router)
    app.include_router(audit.router)

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("kuuna_backend.main:app", host="0.0.0.0", port=8000, reload=True)
