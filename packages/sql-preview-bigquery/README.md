# sql-preview-bigquery

Google BigQuery connector for [SQL Preview](https://github.com/fadnavismehul/sql-preview).

## Connection Profile

```json
{
  "type": "bigquery",
  "projectId": "my-company-prod",
  "location": "US",
  "dataset": "analytics"
}
```

### Key Options

| Option | Required | Default | Notes |
|--------|----------|---------|-------|
| `projectId` | ✅ | — | GCP project ID (the billing project) |
| `location` | — | `US` | Dataset location: `US`, `EU`, `us-central1`, etc. |
| `dataset` | — | — | Default dataset for unqualified table references |
| `keyFilename` | — | — | Absolute path to service account JSON key |
| `credentials` | — | — | Inline service account (overrides keyFilename) |
| `maximumBytesBilled` | — | unlimited | Max bytes to scan per query (cost guard) |
| `timeoutMs` | — | `60000` | Query job timeout in ms |

### Authentication Priority

1. **Inline credentials** (`credentials.client_email` + `credentials.private_key`) — for CI/headless  
2. **Key file** (`keyFilename` path to service account JSON) — for local use  
3. **Application Default Credentials (ADC)** — when neither is set  

> **For local development**: Run `gcloud auth application-default login` and SQL Preview will pick up your credentials automatically — no key file needed.

## Cost Guard

Set `maximumBytesBilled` to prevent runaway queries:

```json
{
  "projectId": "my-project",
  "maximumBytesBilled": 10000000000
}
```

If a query would scan more than 10 GB, BigQuery rejects it and SQL Preview surfaces a clear error with instructions to raise or remove the limit.

## Location

BigQuery datasets have a processing location. Ensure `location` in your profile matches your dataset's location:

- `US` — multi-region United States (default)
- `EU` — multi-region Europe  
- `us-central1`, `europe-west1` — single-region

> **Tip**: Mismatched location is the #1 BigQuery connection issue. If queries fail with "Not found", check that your profile `location` matches the dataset.

## Service Account Setup

```bash
# Create a service account with BigQuery Job User + Data Viewer roles
gcloud iam service-accounts create sql-preview-sa
gcloud projects add-iam-policy-binding my-project \
  --member="serviceAccount:sql-preview-sa@my-project.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"
gcloud projects add-iam-policy-binding my-project \
  --member="serviceAccount:sql-preview-sa@my-project.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

# Download key
gcloud iam service-accounts keys create key.json \
  --iam-account sql-preview-sa@my-project.iam.gserviceaccount.com
```

## MCP / CLI Usage

```bash
# MCP server (stdio)
node dist/cli.js --mcp

# CLI
sql-preview-bigquery --query "SELECT CURRENT_TIMESTAMP()" \
  --config $(echo '{"projectId":"my-project","location":"US"}' | base64)
```

## Development

```bash
npm install
npm test           # unit tests (mocked, no GCP account needed)
npm run build
```
