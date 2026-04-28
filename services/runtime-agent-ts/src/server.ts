import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { defaultModel, defaultReasoningEffort, openAiApiKey, openAiBaseUrl, openAiTimeoutSeconds, port } from "./config.js";
import { runAgent } from "./runner.js";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : {};
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { detail: "not found" });
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && request.url === "/debug/status") {
      sendJson(response, 200, {
        status: "ok",
        openai_configured: Boolean(openAiApiKey()),
        openai_base_url: openAiBaseUrl(),
        openai_timeout_seconds: openAiTimeoutSeconds(),
        default_model: defaultModel(),
        reasoning_effort: defaultReasoningEffort(),
        runtime: "pi-typescript",
      });
      return;
    }

    if (request.method === "POST" && request.url === "/run") {
      const payload = await readJson(request);
      const result = await runAgent(payload);
      sendJson(response, 200, result);
      return;
    }

    notFound(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, {
      detail: `runtime-agent execution failed: ${message}`,
    });
  }
});

server.listen(port(), "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "runtime_agent_ts_started", port: port() }));
});
