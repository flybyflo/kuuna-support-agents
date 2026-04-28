import { createHash } from "node:crypto";

import { getSettings } from "../config.js";
import { logger } from "../logging.js";

export const embeddingDimensions = 1536;
const maxChunkChars = 1000;

export function chunkMarkdown(content: string, maxLength = maxChunkChars): string[] {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!normalized) return [""];

  const paragraphs = normalized.split("\n\n").map((paragraph) => paragraph.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [splitText(normalized, maxLength)[0] ?? ""];

  const chunks: string[] = [];
  let currentChunk = "";
  for (const paragraph of paragraphs) {
    for (const part of splitText(paragraph, maxLength)) {
      if (!currentChunk) {
        currentChunk = part;
        continue;
      }
      const candidate = `${currentChunk}\n\n${part}`;
      if (candidate.length <= maxLength) {
        currentChunk = candidate;
        continue;
      }
      chunks.push(currentChunk);
      currentChunk = part;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks.length ? chunks : [normalized.slice(0, maxLength)];
}

export function tokenCount(content: string): number {
  const stripped = content.trim();
  return stripped ? stripped.split(/\s+/).length : 0;
}

export async function createEmbeddings(
  chunks: string[],
  options: { fallbackLogMessage?: string } = {},
): Promise<number[][]> {
  const normalizedChunks = chunks.map((chunk) => (chunk.trim() ? chunk : "__empty__"));
  const settings = getSettings();

  if (!settings.OPENAI_API_KEY) {
    logger.warn(options.fallbackLogMessage ?? "indexing_openai_not_configured_using_pseudo_embeddings", {
      chunk_count: chunks.length,
    });
    return normalizedChunks.map((chunk) => pseudoEmbedding(chunk));
  }

  const response = await fetch(`${settings.OPENAI_BASE_URL.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.OPENAI_EMBEDDING_MODEL,
      input: normalizedChunks,
    }),
    signal: AbortSignal.timeout(settings.OPENAI_TIMEOUT_SECONDS * 1000),
  });

  if (!response.ok) {
    throw new Error(`openai_embeddings_http_${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = (await response.json()) as { data?: Array<{ embedding?: unknown; index?: unknown }> };
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("openai embeddings returned no data");
  }

  const vectorsByIndex = new Map<number, number[]>();
  for (const [fallbackIndex, item] of payload.data.entries()) {
    if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
      throw new Error("openai embeddings payload is missing vector");
    }
    const vectorIndex = typeof item.index === "number" ? item.index : fallbackIndex;
    vectorsByIndex.set(vectorIndex, item.embedding.map((component) => Number(component)));
  }

  return normalizedChunks.map((_chunk, index) => {
    const vector = vectorsByIndex.get(index);
    if (!vector) {
      throw new Error("openai embeddings response is incomplete");
    }
    if (vector.length !== embeddingDimensions) {
      throw new Error(`embedding dimensions mismatch at index ${index}`);
    }
    return vector;
  });
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value.toFixed(8))).join(",")}]`;
}

function splitText(text: string, maxLength: number): string[] {
  let remaining = text.trim();
  if (!remaining) return [""];

  const parts: string[] = [];
  while (remaining) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt <= 0) splitAt = maxLength;

    const part = remaining.slice(0, splitAt).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(splitAt).trim();
  }
  return parts.length ? parts : [text.slice(0, maxLength)];
}

function pseudoEmbedding(content: string): number[] {
  const seed = content.trim() || "__empty__";
  const vector: number[] = [];
  let counter = 0;

  while (vector.length < embeddingDimensions) {
    const digest = createHash("sha256").update(`${seed}:${counter}`).digest();
    for (let index = 0; index < digest.length; index += 4) {
      const value = digest.readUInt32BE(index);
      vector.push((value / 0xffffffff) * 2 - 1);
      if (vector.length === embeddingDimensions) break;
    }
    counter += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}
