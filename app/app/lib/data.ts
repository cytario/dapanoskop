/** Data fetching utilities. */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { CostSummary } from "~/types/cost-data";
import { getConfig } from "./config";
import { getAwsCredentials } from "./credentials";

const DATA_BASE = import.meta.env.VITE_DATA_BASE_URL ?? "/data";

async function s3GetJson<T>(key: string): Promise<T> {
  const cfg = await getConfig();
  const creds = await getAwsCredentials();
  const client = new S3Client({
    region: cfg.awsRegion,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });
  const res = await client.send(
    new GetObjectCommand({ Bucket: cfg.dataBucketName, Key: key }),
  );
  if (!res.Body) throw new Error(`Empty response for ${key}`);
  return JSON.parse(await res.Body.transformToString()) as T;
}

export async function fetchSummary(period: string): Promise<CostSummary> {
  const cfg = await getConfig();
  if (cfg.authBypass) {
    const response = await fetch(`${DATA_BASE}/${period}/summary.json`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch summary for ${period}: ${response.status}`,
      );
    }
    return response.json();
  }
  return s3GetJson<CostSummary>(`${period}/summary.json`);
}

export async function discoverPeriods(): Promise<string[]> {
  const cfg = await getConfig();

  if (cfg.authBypass) {
    return discoverPeriodsLocal();
  }

  // Production: fetch index.json from S3
  try {
    const data = await s3GetJson<{ periods: string[] }>("index.json");
    return data.periods ?? [];
  } catch {
    // Fall through to local probing (should not happen in production)
  }
  return discoverPeriodsLocal();
}

async function discoverPeriodsLocal(): Promise<string[]> {
  try {
    const response = await fetch(`${DATA_BASE}/index.json`);
    if (response.ok) {
      const data = await response.json();
      return data.periods ?? [];
    }
  } catch {
    // Fall through to probing
  }

  const periods: string[] = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      const res = await fetch(`${DATA_BASE}/${period}/summary.json`, {
        method: "HEAD",
      });
      if (res.ok) periods.push(period);
    } catch {
      // Skip unavailable periods
    }
  }
  return periods;
}
