/**
 * Generates DuckDB SET statements for S3 credential configuration.
 * Single quotes in values are escaped by doubling them (SQL standard).
 */

export interface S3CredentialParams {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Returns an array of DuckDB SET statements for configuring S3 httpfs access.
 */
export function buildS3ConfigStatements(params: S3CredentialParams): string[] {
  return [
    `SET s3_region='${escapeSql(params.region)}'`,
    `SET s3_access_key_id='${escapeSql(params.accessKeyId)}'`,
    `SET s3_secret_access_key='${escapeSql(params.secretAccessKey)}'`,
    `SET s3_session_token='${escapeSql(params.sessionToken)}'`,
  ];
}
