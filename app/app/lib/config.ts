/**
 * Runtime configuration loader.
 * Fetches /config.json (written by Terraform in production).
 * Falls back to VITE_* env vars for local dev.
 */

export interface AppConfig {
  cognitoDomain: string;
  cognitoClientId: string;
  userPoolId: string;
  identityPoolId: string;
  awsRegion: string;
  dataBucketName: string;
  redirectUri: string;
  authBypass: boolean;
}

let cached: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cached) return cached;

  let json: Record<string, string> = {};

  try {
    const res = await fetch("/config.json");
    if (res.ok) {
      json = await res.json();
    }
  } catch {
    // fetch failed — fall through to env vars
  }

  const val = (jsonKey: string, envKey: string) =>
    json[jsonKey] || import.meta.env[envKey] || "";

  const redirectUri =
    import.meta.env.VITE_REDIRECT_URI ??
    (typeof window !== "undefined" ? window.location.origin + "/" : "/");

  cached = {
    cognitoDomain: val("cognitoDomain", "VITE_COGNITO_DOMAIN"),
    cognitoClientId: val("cognitoClientId", "VITE_COGNITO_CLIENT_ID"),
    userPoolId: val("userPoolId", "VITE_USER_POOL_ID"),
    identityPoolId: val("identityPoolId", "VITE_IDENTITY_POOL_ID"),
    awsRegion: val("awsRegion", "VITE_AWS_REGION"),
    dataBucketName: val("dataBucketName", "VITE_DATA_BUCKET_NAME"),
    redirectUri,
    authBypass: import.meta.env.VITE_AUTH_BYPASS === "true",
  };

  return cached;
}
