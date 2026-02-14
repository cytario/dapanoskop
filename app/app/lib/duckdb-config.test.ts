import { describe, expect, test } from "vitest";
import { buildS3ConfigStatements } from "./duckdb-config";

describe("buildS3ConfigStatements", () => {
  test("produces valid SET statements", () => {
    const stmts = buildS3ConfigStatements({
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: "FwoGZXIvYXdzEBY",
    });

    expect(stmts).toHaveLength(4);
    expect(stmts[0]).toBe("SET s3_region='us-east-1'");
    expect(stmts[1]).toBe("SET s3_access_key_id='AKIAIOSFODNN7EXAMPLE'");
    expect(stmts[2]).toBe(
      "SET s3_secret_access_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'",
    );
    expect(stmts[3]).toBe("SET s3_session_token='FwoGZXIvYXdzEBY'");
  });

  test("escapes single quotes in all fields", () => {
    const stmts = buildS3ConfigStatements({
      region: "eu-west-1'injected",
      accessKeyId: "key'with'quotes",
      secretAccessKey: "secret'key",
      sessionToken: "token'value",
    });

    expect(stmts[0]).toBe("SET s3_region='eu-west-1''injected'");
    expect(stmts[1]).toBe("SET s3_access_key_id='key''with''quotes'");
    expect(stmts[2]).toBe("SET s3_secret_access_key='secret''key'");
    expect(stmts[3]).toBe("SET s3_session_token='token''value'");
  });

  test("handles empty string values", () => {
    const stmts = buildS3ConfigStatements({
      region: "",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
    });

    expect(stmts).toHaveLength(4);
    expect(stmts[0]).toBe("SET s3_region=''");
    expect(stmts[1]).toBe("SET s3_access_key_id=''");
    expect(stmts[2]).toBe("SET s3_secret_access_key=''");
    expect(stmts[3]).toBe("SET s3_session_token=''");
  });
});
