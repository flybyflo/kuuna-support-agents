import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createBackendTrpcClient } from "@/lib/backend/client";

type Params = Promise<{
  messageId: string;
  assetId: string;
}>;

function fileExtensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "video/mp4") return "mp4";
  return "bin";
}

function fallbackFilename(input: {
  id: string;
  file_name?: string | null;
  mime_type: string;
}): string {
  const fileName = input.file_name?.trim();
  if (fileName) {
    return fileName;
  }
  return `media-${input.id}.${fileExtensionFromMimeType(input.mime_type)}`;
}

function contentDisposition(filename: string): string {
  const asciiFilename = filename.replace(/[\r\n"]/g, "_");
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function responseFromDataUrl(url: string, filename: string, fallbackMimeType: string): Response | null {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(url);
  if (!match) {
    return null;
  }

  const mimeType = match[1] || fallbackMimeType;
  const encodedBody = match[2] ?? "";
  const isBase64 = url.slice(0, url.indexOf(",")).includes(";base64");
  const body = isBase64
    ? Buffer.from(encodedBody, "base64")
    : Buffer.from(decodeURIComponent(encodedBody), "utf8");

  return new Response(body, {
    headers: {
      "content-type": mimeType,
      "content-disposition": contentDisposition(filename),
      "content-length": String(body.byteLength),
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Params },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ detail: "unauthorized" }, { status: 401 });
  }

  const { messageId, assetId } = await params;
  const client = createBackendTrpcClient(session.backendAccessToken);
  const assets = await client.messages.media.query({ messageId });
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) {
    return NextResponse.json({ detail: "media asset not found" }, { status: 404 });
  }

  const filename = fallbackFilename(asset);
  const downloadUrl =
    asset.download_url ?? (asset.mime_type.startsWith("image/") ? asset.preview_url : null);
  if (!downloadUrl) {
    return NextResponse.json({ detail: "download unavailable" }, { status: 404 });
  }

  if (downloadUrl.startsWith("data:")) {
    return (
      responseFromDataUrl(downloadUrl, filename, asset.mime_type) ??
      NextResponse.json({ detail: "invalid data url" }, { status: 502 })
    );
  }

  const upstream = await fetch(downloadUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ detail: "download failed" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? asset.mime_type,
      "content-disposition": contentDisposition(filename),
      ...(upstream.headers.get("content-length")
        ? { "content-length": upstream.headers.get("content-length") as string }
        : {}),
    },
  });
}
