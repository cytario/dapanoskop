// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

/**
 * Helper: create a minimal JWT with a given payload.
 * Only the middle segment (payload) matters for auth.ts parsing.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const sig = "fake-signature";
  return `${header}.${body}.${sig}`;
}

// We need dynamic imports with vi.resetModules() to get fresh module state
// for each describe block, since auth.ts has module-level `let` state.

vi.mock("~/lib/credentials", () => ({
  clearAwsCredentials: vi.fn(),
}));

// ── Bypass mode tests ───────────────────────────────────────────────

describe("auth (bypass mode)", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("isAuthenticated returns true when authBypass is true", async () => {
    vi.doMock("~/lib/config", () => ({
      getConfig: vi.fn().mockResolvedValue({
        authBypass: true,
        cognitoDomain: "",
        cognitoClientId: "",
        redirectUri: "/",
      }),
    }));
    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(true);
  });

  test("getAccessToken returns 'bypass-token' in bypass mode", async () => {
    vi.doMock("~/lib/config", () => ({
      getConfig: vi.fn().mockResolvedValue({
        authBypass: true,
        cognitoDomain: "",
        cognitoClientId: "",
        redirectUri: "/",
      }),
    }));
    const { initAuth, getAccessToken } = await import("./auth");
    await initAuth();
    expect(getAccessToken()).toBe("bypass-token");
  });
});

// ── Normal mode tests ───────────────────────────────────────────────

function mockNormalConfig() {
  vi.doMock("~/lib/config", () => ({
    getConfig: vi.fn().mockResolvedValue({
      authBypass: false,
      cognitoDomain: "https://auth.example.com",
      cognitoClientId: "test-client-id",
      redirectUri: "http://localhost:3000/",
    }),
  }));
}

describe("auth (normal mode)", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    mockNormalConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("isAuthenticated returns false with no token in sessionStorage", async () => {
    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns true for valid unexpired token", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem("id_token", makeJwt({ exp: futureExp }));

    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(true);
  });

  test("isAuthenticated returns false for expired token", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    sessionStorage.setItem("id_token", makeJwt({ exp: pastExp }));

    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns false for malformed token (not valid base64)", async () => {
    sessionStorage.setItem("id_token", "not.a-valid-base64!.token");

    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns false for token with no exp claim", async () => {
    sessionStorage.setItem("id_token", makeJwt({ sub: "user-123" }));

    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns false for token with exp=0", async () => {
    sessionStorage.setItem("id_token", makeJwt({ exp: 0 }));

    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns false for token with non-numeric exp", async () => {
    sessionStorage.setItem("id_token", makeJwt({ exp: "not-a-number" }));

    const { initAuth, isAuthenticated } = await import("./auth");
    await initAuth();
    expect(isAuthenticated()).toBe(false);
  });
});

// ── generateCodeVerifier ────────────────────────────────────────────

describe("generateCodeVerifier (via login)", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    mockNormalConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("generateCodeVerifier output is >= 43 chars (RFC 7636 minimum entropy)", async () => {
    const { initAuth, login } = await import("./auth");
    await initAuth();

    // login() sets window.location.href which in jsdom logs a warning
    // but does not throw or navigate, so the verifier is safely stored.
    await login();

    const verifier = sessionStorage.getItem("pkce_verifier");
    expect(verifier).not.toBeNull();
    expect(verifier!.length).toBeGreaterThanOrEqual(43);
  });
});

// ── handleCallback ──────────────────────────────────────────────────

describe("handleCallback", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    mockNormalConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up URL
    window.history.replaceState({}, "", window.location.pathname);
  });

  test("handleCallback cleans up pkce_verifier from sessionStorage after use", async () => {
    // Set up: put a code in the URL and a verifier in storage
    const url = new URL(window.location.href);
    url.searchParams.set("code", "auth-code-123");
    window.history.replaceState({}, "", url.toString());
    sessionStorage.setItem("pkce_verifier", "test-verifier-string");

    // Mock fetch to simulate token endpoint success
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id_token: makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { initAuth, handleCallback } = await import("./auth");
    await initAuth();
    const result = await handleCallback();

    expect(result).toBe(true);
    expect(sessionStorage.getItem("pkce_verifier")).toBeNull();

    vi.unstubAllGlobals();
  });

  test("handleCallback returns false when pkce_verifier is missing", async () => {
    // Set up: code in URL but no verifier in storage
    const url = new URL(window.location.href);
    url.searchParams.set("code", "auth-code-123");
    window.history.replaceState({}, "", url.toString());

    const { initAuth, handleCallback } = await import("./auth");
    await initAuth();
    const result = await handleCallback();

    expect(result).toBe(false);
  });
});

// ── logout ──────────────────────────────────────────────────────────

describe("logout", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    mockNormalConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("logout revokes refresh token, clears storage, and redirects to Cognito", async () => {
    sessionStorage.setItem("id_token", "some-id-token");
    sessionStorage.setItem("access_token", "some-access-token");
    sessionStorage.setItem("refresh_token", "some-refresh-token");

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const { initAuth, logout } = await import("./auth");
    await initAuth();

    // logout() will set window.location.href for Cognito logout redirect.
    // In jsdom this is a no-op (doesn't actually navigate), so it's safe.
    await logout();

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.example.com/oauth2/revoke",
      expect.objectContaining({ method: "POST" }),
    );

    expect(sessionStorage.getItem("id_token")).toBeNull();
    expect(sessionStorage.getItem("access_token")).toBeNull();
    expect(sessionStorage.getItem("refresh_token")).toBeNull();

    vi.unstubAllGlobals();
  });
});
