/**
 * Auth module (C-1.1): OIDC Authorization Code + PKCE flow with Cognito.
 * Dev bypass via VITE_AUTH_BYPASS=true.
 *
 * Call initAuth() once before using any other export.
 */

import { getConfig } from "./config";
import { clearAwsCredentials } from "./credentials";

let authBypass = false;
let cognitoDomain = "";
let clientId = "";
let redirectUri = "/";
let initialized = false;

export async function initAuth(): Promise<void> {
  if (initialized) return;
  const cfg = await getConfig();
  authBypass = cfg.authBypass;
  cognitoDomain = cfg.cognitoDomain;
  clientId = cfg.cognitoClientId;
  redirectUri = cfg.redirectUri;
  initialized = true;
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
  if (authBypass) return true;
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
  if (authBypass) return;

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("pkce_verifier", verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.href = `${cognitoDomain}/oauth2/authorize?${params}`;
}

export async function handleCallback(): Promise<boolean> {
  if (authBypass) return true;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;

  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) return false;

  const response = await fetch(`${cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
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
  clearAwsCredentials();
  sessionStorage.removeItem("id_token");
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("refresh_token");
  if (!authBypass && cognitoDomain) {
    const params = new URLSearchParams({
      client_id: clientId,
      logout_uri: redirectUri,
    });
    window.location.href = `${cognitoDomain}/logout?${params}`;
  } else {
    window.location.reload();
  }
}

export function getAccessToken(): string | null {
  if (authBypass) return "bypass-token";
  return sessionStorage.getItem("access_token");
}
