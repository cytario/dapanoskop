/**
 * Vite dev server middleware that proxies /data/* requests to an S3 bucket.
 *
 * Allows running the SPA locally with VITE_AUTH_BYPASS=true while reading
 * real data from S3 instead of local fixtures. Uses the developer's local
 * AWS credentials (SSO profile, env vars, etc.) via the default credential
 * provider chain.
 *
 * Activate by setting VITE_DATA_S3_BUCKET in your .env file.
 * Optionally set VITE_DATA_S3_REGION (defaults to eu-north-1).
 */

import type { Connect } from "vite";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

export interface S3ProxyOptions {
  bucket: string;
  region: string;
}

export function createS3ProxyMiddleware(
  opts: S3ProxyOptions,
): Connect.NextHandleFunction {
  const client = new S3Client({ region: opts.region });

  return async (req, res, next) => {
    // Strip the leading /data/ prefix to get the S3 key
    const key = req.url?.replace(/^\//, "") ?? "";
    if (!key) {
      next();
      return;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: opts.bucket,
        Key: key,
      });
      const response = await client.send(command);

      res.statusCode = 200;
      if (response.ContentType) {
        res.setHeader("Content-Type", response.ContentType);
      }
      if (response.ContentLength !== undefined) {
        res.setHeader("Content-Length", response.ContentLength);
      }

      const body = response.Body;
      if (body && typeof (body as Readable).pipe === "function") {
        (body as Readable).pipe(res);
      } else if (body) {
        const bytes = await body.transformToByteArray();
        res.end(Buffer.from(bytes));
      } else {
        res.statusCode = 404;
        res.end("Not found");
      }
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === "NoSuchKey" || name === "NotFound") {
        res.statusCode = 404;
        res.end("Not found");
      } else {
        const message = err instanceof Error ? err.message : "S3 proxy error";
        console.error(
          `[s3-proxy] Error fetching s3://${opts.bucket}/${key}:`,
          message,
        );
        res.statusCode = 502;
        res.end(`S3 proxy error: ${message}`);
      }
    }
  };
}
