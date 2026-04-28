import type {
  RuntimeMediaAttachment,
  RuntimeMediaInsight,
} from "@kuuna/agent-contracts";
import {
  openAiApiKey,
  openAiAudioTranscriptionModel,
  openAiBaseUrl,
  openAiTimeoutMs,
  openAiVisionModel,
} from "./config.js";

type FetchLike = typeof fetch;

type MediaBytes = {
  bytes: Uint8Array;
  contentType: string;
  dataUrl: string;
};

type OpenAiChatCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type OpenAiTranscription = {
  text?: unknown;
};

export async function analyzeRuntimeMedia(
  attachments: RuntimeMediaAttachment[],
  fetchClient: FetchLike = fetch,
): Promise<RuntimeMediaInsight[]> {
  const insights: RuntimeMediaInsight[] = [];
  for (const attachment of attachments) {
    insights.push(await analyzeAttachment(attachment, fetchClient));
  }
  return insights;
}

function mediaKind(mimeType: string): RuntimeMediaInsight["kind"] {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  return "file";
}

async function analyzeAttachment(
  attachment: RuntimeMediaAttachment,
  fetchClient: FetchLike,
): Promise<RuntimeMediaInsight> {
  const kind = mediaKind(attachment.mime_type);
  if (kind !== "image" && kind !== "audio") {
    return {
      media_asset_id: attachment.media_asset_id,
      mime_type: attachment.mime_type,
      kind,
      status: "skipped",
      summary: attachment.transcript ?? null,
      transcript: attachment.transcript ?? null,
    };
  }

  const apiKey = openAiApiKey();
  if (!apiKey) {
    return {
      media_asset_id: attachment.media_asset_id,
      mime_type: attachment.mime_type,
      kind,
      status: "skipped",
      summary: attachment.transcript ?? null,
      transcript: attachment.transcript ?? null,
      error: "openai_api_key_missing",
    };
  }

  try {
    const sourceUrl = mediaSourceUrl(attachment, kind);
    if (!sourceUrl) {
      throw new Error("media_url_missing");
    }
    const media = await loadMedia(sourceUrl, attachment.mime_type, fetchClient);
    if (kind === "image") {
      const summary = await analyzeImage(media.dataUrl, apiKey, fetchClient);
      return {
        media_asset_id: attachment.media_asset_id,
        mime_type: attachment.mime_type,
        kind,
        status: "ready",
        summary,
        transcript: summary,
      };
    }

    const transcript = await transcribeAudio(
      media.bytes,
      media.contentType,
      attachment.file_name ?? "audio",
      apiKey,
      fetchClient,
    );
    return {
      media_asset_id: attachment.media_asset_id,
      mime_type: attachment.mime_type,
      kind,
      status: "ready",
      summary: transcript,
      transcript,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      media_asset_id: attachment.media_asset_id,
      mime_type: attachment.mime_type,
      kind,
      status: "failed",
      summary: attachment.transcript ?? null,
      transcript: attachment.transcript ?? null,
      error: message,
    };
  }
}

function mediaSourceUrl(
  attachment: RuntimeMediaAttachment,
  kind: RuntimeMediaInsight["kind"],
): string | null {
  if (kind === "image") {
    return attachment.preview_url ?? attachment.object_url ?? null;
  }
  return attachment.object_url ?? attachment.preview_url ?? null;
}

async function loadMedia(
  url: string,
  fallbackContentType: string,
  fetchClient: FetchLike,
): Promise<MediaBytes> {
  if (url.startsWith("data:")) {
    return mediaBytesFromDataUrl(url, fallbackContentType);
  }

  const response = await fetchClient(url, {
    method: "GET",
    signal: AbortSignal.timeout(openAiTimeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`media_fetch_http_${response.status}`);
  }
  const contentType =
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
    fallbackContentType;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    contentType,
    dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

function mediaBytesFromDataUrl(url: string, fallbackContentType: string): MediaBytes {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) {
    throw new Error("invalid_data_url");
  }
  const contentType = match[1] || fallbackContentType;
  const encoded = match[3] ?? "";
  const bytes = match[2]
    ? Buffer.from(encoded, "base64")
    : Buffer.from(decodeURIComponent(encoded), "utf8");
  return {
    bytes,
    contentType,
    dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

async function analyzeImage(
  imageDataUrl: string,
  apiKey: string,
  fetchClient: FetchLike,
): Promise<string> {
  const response = await fetchClient(`${openAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAiVisionModel(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this WhatsApp image for a support staff todo. Summarize visible text, entities, dates, amounts, and the concrete follow-up needed. Be concise.",
            },
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(openAiTimeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`openai_vision_http_${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as OpenAiChatCompletion;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  throw new Error("openai_vision_empty_response");
}

async function transcribeAudio(
  bytes: Uint8Array,
  contentType: string,
  filename: string,
  apiKey: string,
  fetchClient: FetchLike,
): Promise<string> {
  const body = new FormData();
  body.set("model", openAiAudioTranscriptionModel());
  body.set(
    "file",
    new Blob([bytes], { type: contentType }),
    filenameWithExtension(filename, contentType),
  );

  const response = await fetchClient(`${openAiBaseUrl()}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    signal: AbortSignal.timeout(openAiTimeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`openai_transcription_http_${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as OpenAiTranscription;
  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }
  throw new Error("openai_transcription_empty_response");
}

function filenameWithExtension(filename: string, contentType: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) {
    return filename;
  }
  if (contentType === "audio/mpeg") return `${filename}.mp3`;
  if (contentType === "audio/ogg") return `${filename}.ogg`;
  if (contentType === "audio/mp4") return `${filename}.m4a`;
  if (contentType === "audio/wav" || contentType === "audio/wave") return `${filename}.wav`;
  return `${filename}.bin`;
}
