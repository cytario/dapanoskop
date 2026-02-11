/**
 * Runtime configuration loader.
 * Fetches /config.json (written by Terraform in production).
 * Falls back to VITE_* env vars for local dev.
 */

interface AppConfig {
  cognitoDomain: string;
  cognitoClientId: string;
  redirectUri: string;
  authBypass: boolean;
}

let cached: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cached) return cached;

  let cognitoDomain = "";
  let cognitoClientId = "";

  try {
    const res = await fetch("/config.json");
    if (res.ok) {
      const json = await res.json();
      cognitoDomain = json.cognitoDomain ?? "";
      cognitoClientId = json.cognitoClientId ?? "";
    }
  } catch {
    // fetch failed — fall through to env vars
  }

  // Fall back to build-time env vars if config.json was empty or missing
  if (!cognitoDomain) {
    cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN ?? "";
  }
  if (!cognitoClientId) {
    cognitoClientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";
  }

  const redirectUri =
    import.meta.env.VITE_REDIRECT_URI ??
    (typeof window !== "undefined" ? window.location.origin + "/" : "/");

  cached = {
    cognitoDomain,
    cognitoClientId,
    redirectUri,
    authBypass: import.meta.env.VITE_AUTH_BYPASS === "true",
  };

  return cached;
}
