import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getRuntimeDebugStatus } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/format";

export default async function RuntimeDebugPage() {
  const status = await getRuntimeDebugStatus();

  const healthTone = status.runtimeHealth === "ok" ? "success" : "warning";
  const healthTitle =
    status.runtimeHealth === "ok"
      ? "Runtime agent reachable"
      : status.runtimeHealth === "error"
        ? "Runtime agent responded with error"
        : "Runtime agent unreachable";

  return (
    <div className="grid">
      <PageHeader
        title="Runtime Debug"
        description="Quick health and model wiring checks for runtime-agent and OpenAI settings."
      />

      <Notice title={healthTitle} tone={healthTone}>
        <p className="muted-text">
          Health: <strong>{status.runtimeHealth}</strong>
        </p>
        {status.runtimeUrl ? (
          <p className="muted-text">
            Runtime URL: <span className="inline-code">{status.runtimeUrl}</span>
          </p>
        ) : null}
        {status.error ? <p className="muted-text">Error: {status.error}</p> : null}
      </Notice>

      <section className="panel stack">
        <h2>OpenAI wiring</h2>
        <p className="muted-text">
          OPENAI configured: <strong>{status.openaiConfigured === null ? "unknown" : status.openaiConfigured ? "yes" : "no"}</strong>
        </p>
        <p className="muted-text">
          Base URL: <span className="inline-code">{status.openaiBaseUrl ?? "n/a"}</span>
        </p>
        <p className="muted-text">
          Timeout: <span className="inline-code">{status.openaiTimeoutSeconds ?? "n/a"}</span>
        </p>
      </section>

      <section className="panel stack">
        <h2>Latest outbound model path</h2>
        <p className="muted-text">
          Last model used: <strong>{status.lastModelUsed ?? "n/a"}</strong>
        </p>
        <p className="muted-text">
          Model path:{" "}
          <span className="inline-code">
            {status.lastModelPath.length ? status.lastModelPath.join(" -> ") : "n/a"}
          </span>
        </p>
        <p className="muted-text">
          Last outbound intent:{" "}
          <span className="inline-code">{status.lastOutboundIntentId ?? "n/a"}</span>
        </p>
        <p className="muted-text">
          Last outbound at: {status.lastOutboundAt ? formatDateTime(status.lastOutboundAt) : "n/a"}
        </p>
      </section>
    </div>
  );
}
