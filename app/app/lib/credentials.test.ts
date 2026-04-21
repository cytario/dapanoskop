// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const mockConfig = {
  authBypass: false,
  cognitoDomain: "",
  cognitoClientId: "",
  userPoolId: "us-east-1_abc",
  identityPoolId: "us-east-1:pool-id",
  awsRegion: "us-east-1",
  dataBucketName: "data-bucket",
  redirectUri: "/",
};

function mockConfigModule() {
  vi.doMock("~/lib/config", () => ({
    getConfig: vi.fn().mockResolvedValue(mockConfig),
  }));
}

type SendMock = ReturnType<typeof vi.fn>;

/**
 * Stubs @aws-sdk/client-cognito-identity so each CognitoIdentityClient
 * instance receives the same `send` mock. Returns the mock so tests can
 * program per-call responses and assert call counts.
 */
function mockCognitoSdk(): { send: SendMock } {
  const send = vi.fn();
  class CognitoIdentityClient {
    send = send;
  }
  class GetIdCommand {
    constructor(public input: unknown) {}
  }
  class GetCredentialsForIdentityCommand {
    constructor(public input: unknown) {}
  }
  vi.doMock("@aws-sdk/client-cognito-identity", () => ({
    CognitoIdentityClient,
    GetIdCommand,
    GetCredentialsForIdentityCommand,
  }));
  return { send };
}

function credsResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Credentials: {
      AccessKeyId: "AKIA-TEST",
      SecretKey: "secret-key",
      SessionToken: "session-token",
      Expiration: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  };
}

describe("getAwsCredentials", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    sessionStorage.setItem("id_token", "test-id-token");
    mockConfigModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns cached credentials when still within REFRESH_BUFFER_MS", async () => {
    const { send } = mockCognitoSdk();
    send
      .mockResolvedValueOnce({ IdentityId: "id-1" })
      .mockResolvedValueOnce(credsResponse());

    const { getAwsCredentials } = await import("./credentials");
    const first = await getAwsCredentials();
    const second = await getAwsCredentials();

    expect(first).toBe(second);
    // 2 sends for the first call (GetId + GetCredentials), 0 for the second
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("refetches when cache is within REFRESH_BUFFER_MS of expiry", async () => {
    const { send } = mockCognitoSdk();
    // First credentials expire in 4 minutes — inside the 5-minute buffer
    send
      .mockResolvedValueOnce({ IdentityId: "id-1" })
      .mockResolvedValueOnce(
        credsResponse({ Expiration: new Date(Date.now() + 4 * 60 * 1000) }),
      )
      // Second call triggers a fresh GetCredentialsForIdentity (identityId reused)
      .mockResolvedValueOnce(credsResponse());

    const { getAwsCredentials } = await import("./credentials");
    await getAwsCredentials();
    await getAwsCredentials();

    // GetId called once (identityId cached), GetCredentials called twice
    expect(send).toHaveBeenCalledTimes(3);
  });

  test("concurrent callers share the same in-flight promise", async () => {
    const { send } = mockCognitoSdk();
    send
      .mockResolvedValueOnce({ IdentityId: "id-1" })
      .mockResolvedValueOnce(credsResponse());

    const { getAwsCredentials } = await import("./credentials");
    const [a, b, c] = await Promise.all([
      getAwsCredentials(),
      getAwsCredentials(),
      getAwsCredentials(),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    // Only one underlying fetch (2 sends: GetId + GetCredentials)
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("reuses identityId across calls after cache expiry", async () => {
    const { send } = mockCognitoSdk();
    // First cycle: GetId + GetCredentials (short-lived creds to force refetch)
    send
      .mockResolvedValueOnce({ IdentityId: "id-cached" })
      .mockResolvedValueOnce(
        credsResponse({ Expiration: new Date(Date.now() + 4 * 60 * 1000) }),
      )
      // Second cycle: ONLY GetCredentials (no GetId)
      .mockResolvedValueOnce(credsResponse());

    const { getAwsCredentials } = await import("./credentials");
    await getAwsCredentials();
    await getAwsCredentials();

    // send called 3 times total — proves GetId skipped on second call
    expect(send).toHaveBeenCalledTimes(3);
  });

  test("clearAwsCredentials resets cached credentials and identityId", async () => {
    const { send } = mockCognitoSdk();
    send
      .mockResolvedValueOnce({ IdentityId: "id-1" })
      .mockResolvedValueOnce(credsResponse())
      // After clear: GetId must run again
      .mockResolvedValueOnce({ IdentityId: "id-2" })
      .mockResolvedValueOnce(credsResponse());

    const mod = await import("./credentials");
    await mod.getAwsCredentials();
    mod.clearAwsCredentials();
    await mod.getAwsCredentials();

    // 4 total sends: GetId + GetCreds, then GetId + GetCreds again
    expect(send).toHaveBeenCalledTimes(4);
  });

  test("throws when id_token is missing from sessionStorage", async () => {
    mockCognitoSdk();
    sessionStorage.removeItem("id_token");

    const { getAwsCredentials } = await import("./credentials");
    await expect(getAwsCredentials()).rejects.toThrow("No ID token available");
  });

  test("throws when GetId returns no IdentityId", async () => {
    const { send } = mockCognitoSdk();
    send.mockResolvedValueOnce({});

    const { getAwsCredentials } = await import("./credentials");
    await expect(getAwsCredentials()).rejects.toThrow(
      "GetId returned no IdentityId",
    );
  });

  test.each([
    ["AccessKeyId", { AccessKeyId: undefined }],
    ["SecretKey", { SecretKey: undefined }],
    ["SessionToken", { SessionToken: undefined }],
    ["Expiration", { Expiration: undefined }],
  ])(
    "throws when Cognito credentials response is missing %s",
    async (_label, overrides) => {
      const { send } = mockCognitoSdk();
      send
        .mockResolvedValueOnce({ IdentityId: "id-1" })
        .mockResolvedValueOnce(credsResponse(overrides));

      const { getAwsCredentials } = await import("./credentials");
      await expect(getAwsCredentials()).rejects.toThrow(
        "Incomplete credentials from Identity Pool",
      );
    },
  );

  test("returns mapped AwsCredentials with expiration as Unix ms", async () => {
    const { send } = mockCognitoSdk();
    const expiryDate = new Date(Date.now() + 30 * 60 * 1000);
    send
      .mockResolvedValueOnce({ IdentityId: "id-1" })
      .mockResolvedValueOnce(credsResponse({ Expiration: expiryDate }));

    const { getAwsCredentials } = await import("./credentials");
    const creds = await getAwsCredentials();

    expect(creds).toEqual({
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret-key",
      sessionToken: "session-token",
      expiration: expiryDate.getTime(),
    });
  });
});

describe("getIdToken", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });

  test("returns the value stored under id_token", async () => {
    sessionStorage.setItem("id_token", "abc.def.ghi");
    const { getIdToken } = await import("./credentials");
    expect(getIdToken()).toBe("abc.def.ghi");
  });

  test("returns null when no token is present", async () => {
    const { getIdToken } = await import("./credentials");
    expect(getIdToken()).toBeNull();
  });
});
