# Backfill Usage Guide

The Dapanoskop Lambda now supports backfilling historical cost data from AWS Cost Explorer.

## Triggering Backfill

### Via AWS Lambda Console Test Event

Create a test event with the following payload:

```json
{
  "backfill": true,
  "months": 13,
  "force": false
}
```

**Parameters:**
- `backfill` (boolean, required): Set to `true` to enable backfill mode
- `months` (integer, optional): Number of historical months to process (default: 13)
- `force` (boolean, optional): Reprocess months that already exist in S3 (default: false)

### Via AWS CLI

```bash
aws lambda invoke \
  --function-name dapanoskop-pipeline \
  --payload '{"backfill": true, "months": 13, "force": false}' \
  response.json
```

### Via boto3

```python
import boto3
import json

lambda_client = boto3.client('lambda')

response = lambda_client.invoke(
    FunctionName='dapanoskop-pipeline',
    InvocationType='RequestResponse',
    Payload=json.dumps({
        'backfill': True,
        'months': 13,
        'force': False
    })
)

result = json.loads(response['Payload'].read())
print(json.dumps(result, indent=2))
```

## Response Format

### Success (200)
All months processed successfully:
```json
{
  "statusCode": 200,
  "body": {
    "message": "backfill_complete",
    "succeeded": ["2026-01", "2025-12", "2025-11", ...],
    "failed": [],
    "skipped": []
  }
}
```

### Partial Success (207)
Some months failed:
```json
{
  "statusCode": 207,
  "body": {
    "message": "backfill_complete",
    "succeeded": ["2026-01", "2025-12"],
    "failed": [
      {
        "period": "2025-11",
        "error": "Rate exceeded: Throttling error"
      }
    ],
    "skipped": []
  }
}
```

## Behavior

### Default Mode (force=false)
- Checks if each month already exists in S3
- Skips months with existing data
- Processes only missing months
- Idempotent: safe to run multiple times

### Force Mode (force=true)
- Processes all requested months
- Overwrites existing S3 data
- Use for fixing corrupted data or after config changes

### Processing Order
Months are processed sequentially in reverse chronological order (newest first).

### Error Handling
- Continues processing remaining months if one fails
- Logs error details for each failed month
- Returns 207 status code if any month fails
- Updates index.json even if some months fail

## Example Use Cases

### Initial Setup
Populate all historical data (up to 13 months):
```json
{"backfill": true, "months": 13}
```

### Fill Recent Gaps
Backfill last 3 months:
```json
{"backfill": true, "months": 3}
```

### Reprocess After Config Change
Force reprocess all data with new cost category or storage config:
```json
{"backfill": true, "months": 13, "force": true}
```

### Resume After Partial Failure
Run again with same parameters (skips succeeded months automatically):
```json
{"backfill": true, "months": 13}
```

## Lambda Timeout Considerations

- Default timeout: 15 minutes (recommended minimum: 5 minutes)
- Average processing time: 5-15 seconds per month
- 13 months ≈ 2-3 minutes total
- Set higher timeout for larger datasets or slower CE API responses

## Cost Explorer API Limits

- Sequential processing prevents throttling
- Uses adaptive retry for transient errors
- Consider AWS Cost Explorer API quotas:
  - GetCostAndUsage: 5 requests/second
  - Pagination tokens required for large result sets
