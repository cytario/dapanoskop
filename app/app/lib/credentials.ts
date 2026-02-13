/**
 * AWS temporary credentials via Cognito Identity Pool (enhanced flow).
 * Used by the S3 client (JSON fetches) and DuckDB-wasm httpfs (parquet).
 */

import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";
import { getConfig } from "./config";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: number; // Unix ms
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

let cached: AwsCredentials | null = null;
let identityId: string | null = null;
let inflightPromise: Promise<AwsCredentials> | null = null;

/**
 * Get temporary AWS credentials. Caches and auto-refreshes.
 * Concurrent callers share the same in-flight request (promise dedup).
 */
export async function getAwsCredentials(): Promise<AwsCredentials> {
  if (cached && Date.now() + REFRESH_BUFFER_MS < cached.expiration) {
    return cached;
  }

  if (inflightPromise) return inflightPromise;

  inflightPromise = fetchCredentials();
  try {
    const creds = await inflightPromise;
    cached = creds;
    return creds;
  } finally {
    inflightPromise = null;
  }
}

export function clearAwsCredentials(): void {
  cached = null;
  identityId = null;
  inflightPromise = null;
}

export function getIdToken(): string | null {
  return typeof window !== "undefined"
    ? sessionStorage.getItem("id_token")
    : null;
}

async function fetchCredentials(): Promise<AwsCredentials> {
  const cfg = await getConfig();
  const idToken = getIdToken();
  if (!idToken) throw new Error("No ID token available");

  const client = new CognitoIdentityClient({ region: cfg.awsRegion });
  const logins = {
    [`cognito-idp.${cfg.awsRegion}.amazonaws.com/${cfg.userPoolId}`]: idToken,
  };

  // Step 1: GetId (reuse cached identityId)
  if (!identityId) {
    const res = await client.send(
      new GetIdCommand({ IdentityPoolId: cfg.identityPoolId, Logins: logins }),
    );
    identityId = res.IdentityId ?? null;
    if (!identityId) throw new Error("GetId returned no IdentityId");
  }

  // Step 2: GetCredentialsForIdentity (enhanced flow)
  const res = await client.send(
    new GetCredentialsForIdentityCommand({
      IdentityId: identityId,
      Logins: logins,
    }),
  );

  const c = res.Credentials;
  if (!c?.AccessKeyId || !c.SecretKey || !c.SessionToken || !c.Expiration) {
    throw new Error("Incomplete credentials from Identity Pool");
  }

  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration.getTime(),
  };
}
