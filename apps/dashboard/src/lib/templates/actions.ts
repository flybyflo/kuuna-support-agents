"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireAuthorized } from "@/lib/auth/guards";

const BACKEND_URL_CANDIDATES = [
  process.env.BACKEND_BASE_URL,
  process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://backend:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://host.docker.internal:8000",
]
  .filter((value): value is string => Boolean(value))
  .filter((value, index, self) => self.indexOf(value) === index);

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeTemplateKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_.\s]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function splitCsvLike(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeKnowledgeDocKeys(value: string | null): string | string[] {
  if (!value) {
    return "*";
  }

  const normalized = value.trim();
  if (!normalized || normalized === "*") {
    return "*";
  }

  if (["none", "off", "false"].includes(normalized.toLowerCase())) {
    return "none";
  }

  return splitCsvLike(normalized);
}

function shortReason(reason: string): string {
  return reason.slice(0, 220);
}

function rethrowRedirectError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}

async function callBackend<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const networkErrors: string[] = [];

  for (const backendBaseUrl of BACKEND_URL_CANDIDATES) {
    const normalizedBaseUrl = backendBaseUrl.replace(/\/$/, "");

    try {
      const response = await fetch(`${normalizedBaseUrl}${path}`, {
        ...init,
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${normalizedBaseUrl} -> ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      rethrowRedirectError(error);
      const reason = error instanceof Error ? error.message : String(error);

      if (reason.includes("-> ") && reason.includes(": ")) {
        throw error;
      }

      networkErrors.push(`${normalizedBaseUrl} -> ${reason}`);
    }
  }

  throw new Error(
    networkErrors.length
      ? `network: ${networkErrors.join(" | ")}`
      : "no-backend-url",
  );
}

export async function createTemplateAction(formData: FormData): Promise<void> {
  await requireAuthorized("templates", "write");

  const keyInput = clean(formData.get("key"));
  const displayName = clean(formData.get("displayName"));

  if (!keyInput || !displayName) {
    redirect("/templates/new?error=missing-fields");
  }

  const key = normalizeTemplateKey(keyInput);
  if (!key) {
    redirect("/templates/new?error=invalid-key");
  }

  try {
    const payload = await callBackend<{ id?: string }>("/templates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key,
        display_name: displayName,
      }),
    });

    if (payload.id) {
      redirect(`/templates/${encodeURIComponent(payload.id)}?created=1`);
    }

    redirect("/templates?created=1");
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(`/templates/new?error=${encodeURIComponent(shortReason(reason))}`);
  }
}

export async function createTemplateDraftVersionAction(formData: FormData): Promise<void> {
  await requireAuthorized("templates", "write");

  const templateId = clean(formData.get("templateId"));
  const systemPrompt = clean(formData.get("systemPrompt")) ?? "";
  const modelChainInput = clean(formData.get("modelChain"));
  const allowedToolsInput = clean(formData.get("allowedTools"));
  const commonKnowledgeDocKeys = normalizeKnowledgeDocKeys(
    clean(formData.get("commonKnowledgeDocKeys")),
  );
  const groupKnowledgeDocKeys = normalizeKnowledgeDocKeys(
    clean(formData.get("groupKnowledgeDocKeys")),
  );
  const includeGroupKnowledge = formData.get("includeGroupKnowledge") === "on";
  const egressMode = clean(formData.get("egressMode")) ?? "restricted";

  if (!templateId) {
    redirect("/templates?error=missing-template-id");
  }

  const modelChain = splitCsvLike(modelChainInput);
  const allowedTools = splitCsvLike(allowedToolsInput).map((tool) => tool.toLowerCase());

  try {
    const payload = await callBackend<{ id?: string }>(`/templates/${templateId}/versions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        model_settings: {
          failover_chain: modelChain.length ? modelChain : ["gpt-5.5"],
          reasoning_effort: "medium",
        },
        tools_config: {
          allowed_tools: allowedTools,
          knowledge: {
            common_doc_keys: commonKnowledgeDocKeys,
            group_doc_keys: groupKnowledgeDocKeys,
            include_group_knowledge: includeGroupKnowledge,
          },
        },
        egress_policy: {
          mode: egressMode,
        },
      }),
    });

    const params = new URLSearchParams({ draft: "1" });
    if (payload.id) {
      params.set("versionId", payload.id);
    }
    redirect(`/templates/${encodeURIComponent(templateId)}?${params.toString()}`);
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(
      `/templates/${encodeURIComponent(templateId)}?error=${encodeURIComponent(shortReason(reason))}`,
    );
  }
}

export async function publishTemplateVersionAction(formData: FormData): Promise<void> {
  await requireAuthorized("templates", "publish");

  const templateId = clean(formData.get("templateId"));
  const versionId = clean(formData.get("versionId"));

  if (!templateId || !versionId) {
    redirect("/templates?error=missing-template-or-version-id");
  }

  try {
    await callBackend(`/templates/${templateId}/versions/${versionId}/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });

    const params = new URLSearchParams({ published: "1", versionId });
    redirect(`/templates/${encodeURIComponent(templateId)}?${params.toString()}`);
  } catch (error) {
    rethrowRedirectError(error);
    const reason = error instanceof Error ? error.message : String(error);
    redirect(
      `/templates/${encodeURIComponent(templateId)}?error=${encodeURIComponent(shortReason(reason))}`,
    );
  }
}
