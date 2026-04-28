import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getSettings } from "../config.js";

let cachedClient: S3Client | null | undefined;
const ensuredBuckets = new Set<string>();

function getS3Client(): S3Client | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const settings = getSettings();
  if (!settings.S3_ENDPOINT_URL && (!settings.S3_ACCESS_KEY || !settings.S3_SECRET_KEY)) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: settings.S3_REGION,
    endpoint: settings.S3_ENDPOINT_URL,
    forcePathStyle: Boolean(settings.S3_ENDPOINT_URL),
    credentials:
      settings.S3_ACCESS_KEY && settings.S3_SECRET_KEY
        ? {
            accessKeyId: settings.S3_ACCESS_KEY,
            secretAccessKey: settings.S3_SECRET_KEY,
          }
        : undefined,
  });
  return cachedClient;
}

export function publicUrlFromKey(objectKey: string, bucketName = getSettings().S3_BUCKET): string | null {
  const settings = getSettings();
  if (!settings.S3_PUBLIC_BASE_URL) {
    return null;
  }
  return `${settings.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${bucketName}/${objectKey}`;
}

export async function uploadBytes(input: {
  bucketName?: string;
  objectKey: string;
  data: Uint8Array;
  contentType: string;
}): Promise<void> {
  const client = getS3Client();
  if (!client) {
    return;
  }

  const bucketName = input.bucketName ?? getSettings().S3_BUCKET;
  await ensureBucketExists(client, bucketName);
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: input.objectKey,
      Body: input.data,
      ContentType: input.contentType,
    }),
  );
}

async function ensureBucketExists(client: S3Client, bucketName: string): Promise<void> {
  if (ensuredBuckets.has(bucketName)) {
    return;
  }

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }

  ensuredBuckets.add(bucketName);
}

export async function createPresignedGetUrl(input: {
  bucketName?: string;
  objectKey: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const publicUrl = publicUrlFromKey(input.objectKey, input.bucketName);
  if (publicUrl) {
    return publicUrl;
  }

  const client = getS3Client();
  if (!client) {
    return null;
  }

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: input.bucketName ?? getSettings().S3_BUCKET,
      Key: input.objectKey,
    }),
    { expiresIn: input.expiresInSeconds ?? 7 * 24 * 60 * 60 },
  );
}
