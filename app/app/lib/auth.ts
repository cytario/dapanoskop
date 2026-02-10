/**
 * Auth module (C-1.1): OIDC Authorization Code + PKCE flow with Cognito.
 * Dev bypass via VITE_AUTH_BYPASS=true.
 */

const AUTH_BYPASS = import.meta.env.VITE_AUTH_BYPASS === "true";
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN ?? "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

function getRedirectUri(): string {
  return (
    import.meta.env.VITE_REDIRECT_URI ??
    (typeof window !== "undefined" ? window.location.origin + "/" : "/")
  );
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function isAuthenticated(): boolean {
  if (AUTH_BYPASS) return true;
  const token = sessionStorage.getItem("id_token");
  if (!token) return false;
  // Basic expiry check
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export async function login(): Promise<void> {
  if (AUTH_BYPASS) return;

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("pkce_verifier", verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: getRedirectUri(),
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}

export async function handleCallback(): Promise<boolean> {
  if (AUTH_BYPASS) return true;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;

  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) return false;

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) return false;

  const tokens = await response.json();
  sessionStorage.setItem("id_token", tokens.id_token);
  sessionStorage.setItem("access_token", tokens.access_token);
  if (tokens.refresh_token) {
    sessionStorage.setItem("refresh_token", tokens.refresh_token);
  }
  sessionStorage.removeItem("pkce_verifier");

  // Remove code from URL
  window.history.replaceState({}, "", window.location.pathname);
  return true;
}

export function logout(): void {
  sessionStorage.removeItem("id_token");
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("refresh_token");
  if (!AUTH_BYPASS && COGNITO_DOMAIN) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      logout_uri: getRedirectUri(),
    });
    window.location.href = `${COGNITO_DOMAIN}/logout?${params}`;
  } else {
    window.location.reload();
  }
}

export function getAccessToken(): string | null {
  if (AUTH_BYPASS) return "bypass-token";
  return sessionStorage.getItem("access_token");
}
