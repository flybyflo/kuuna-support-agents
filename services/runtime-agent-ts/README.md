# Kuuna Runtime Agent TS

TypeScript runtime-agent container host.

The service owns the HTTP/tRPC server, health/debug endpoints, and container
host/port config. Pi SDK integration, model selection, prompt assembly, runtime
identity checks, and Kuuna-only custom tools live in the `@kuuna/pi-runtime`
workspace package so Turbo can build and test that adapter independently.
