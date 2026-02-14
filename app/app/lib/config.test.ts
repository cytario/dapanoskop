// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

describe("getConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("returns config from /config.json when fetch succeeds", async () => {
    const mockJson = {
      cognitoDomain: "https://auth.prod.example.com",
      cognitoClientId: "prod-client-id",
      userPoolId: "us-east-1_abc",
      identityPoolId: "us-east-1:identity-pool",
      awsRegion: "us-east-1",
      dataBucketName: "prod-bucket",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockJson),
      }),
    );

    const { getConfig } = await import("./config");
    const config = await getConfig();

    expect(config.cognitoDomain).toBe("https://auth.prod.example.com");
    expect(config.cognitoClientId).toBe("prod-client-id");
    expect(config.userPoolId).toBe("us-east-1_abc");
    expect(config.identityPoolId).toBe("us-east-1:identity-pool");
    expect(config.awsRegion).toBe("us-east-1");
    expect(config.dataBucketName).toBe("prod-bucket");
  });

  test("falls back to VITE_* env vars when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    vi.stubEnv("VITE_COGNITO_DOMAIN", "https://auth.dev.example.com");
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "dev-client-id");
    vi.stubEnv("VITE_USER_POOL_ID", "us-west-2_xyz");
    vi.stubEnv("VITE_IDENTITY_POOL_ID", "us-west-2:dev-pool");
    vi.stubEnv("VITE_AWS_REGION", "us-west-2");
    vi.stubEnv("VITE_DATA_BUCKET_NAME", "dev-bucket");

    const { getConfig } = await import("./config");
    const config = await getConfig();

    expect(config.cognitoDomain).toBe("https://auth.dev.example.com");
    expect(config.cognitoClientId).toBe("dev-client-id");
    expect(config.userPoolId).toBe("us-west-2_xyz");
    expect(config.identityPoolId).toBe("us-west-2:dev-pool");
    expect(config.awsRegion).toBe("us-west-2");
    expect(config.dataBucketName).toBe("dev-bucket");
  });

  test("caches result after first call", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          cognitoDomain: "https://cached.example.com",
          cognitoClientId: "cached-id",
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { getConfig } = await import("./config");
    const first = await getConfig();
    const second = await getConfig();

    expect(first).toBe(second); // same object reference
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("authBypass is true only when VITE_AUTH_BYPASS === 'true'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("no config.json")),
    );

    // Case 1: VITE_AUTH_BYPASS = "true"
    vi.stubEnv("VITE_AUTH_BYPASS", "true");
    const mod1 = await import("./config");
    const config1 = await mod1.getConfig();
    expect(config1.authBypass).toBe(true);

    // Reset for case 2
    vi.resetModules();
    vi.stubEnv("VITE_AUTH_BYPASS", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("no config.json")),
    );
    const mod2 = await import("./config");
    const config2 = await mod2.getConfig();
    expect(config2.authBypass).toBe(false);

    // Reset for case 3: not set at all
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("no config.json")),
    );
    const mod3 = await import("./config");
    const config3 = await mod3.getConfig();
    expect(config3.authBypass).toBe(false);
  });
});
