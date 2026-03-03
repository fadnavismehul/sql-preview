# sql-preview-snowflake

Snowflake connector for [SQL Preview](https://github.com/fadnavismehul/sql-preview), enabling MCP agents to query Snowflake data warehouses.

## Connection Profile

```json
{
  "type": "snowflake",
  "account": "myorg-myaccount",
  "username": "sqladmin",
  "password": "YourPassword",
  "warehouse": "COMPUTE_WH",
  "database": "ANALYTICS",
  "schema": "PUBLIC",
  "role": "SYSADMIN"
}
```

### Key Options

| Option | Required | Default | Notes |
|--------|----------|---------|-------|
| `account` | ✅ | — | Snowflake account identifier (e.g. `myorg-myaccount`) |
| `username` | ✅ | — | Snowflake login name |
| `password` | — | — | Mutually exclusive with `privateKeyPath` |
| `privateKeyPath` | — | — | Absolute path to PEM private key for key pair auth |
| `privateKeyPassphrase` | — | — | Passphrase for encrypted private key |
| `warehouse` | — | — | Compute warehouse (strongly recommended) |
| `database` | — | — | Default database |
| `schema` | — | — | Default schema |
| `role` | — | — | Snowflake role |
| `loginTimeout` | — | `60` | Login timeout in seconds |
| `application` | — | `sql-preview` | Application name reported to Snowflake |

### Account Identifier

The `account` field accepts any of these formats — they're all normalised automatically:
- `myorg-myaccount` ← preferred
- `myorg-myaccount.snowflakecomputing.com`
- `https://myorg-myaccount.snowflakecomputing.com`

Find your account identifier in Snowsight: **Admin → Accounts → your account → copy**.

## Key Pair Authentication

Generate a key pair per [Snowflake docs](https://docs.snowflake.com/en/user-guide/key-pair-auth):

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.pem -nocrypt
openssl rsa -in rsa_key.pem -pubout -out rsa_key.pub
```

Assign the public key to your Snowflake user, then configure:

```json
{
  "type": "snowflake",
  "account": "myorg-myaccount",
  "username": "sqladmin",
  "privateKeyPath": "/absolute/path/to/rsa_key.pem",
  "warehouse": "COMPUTE_WH"
}
```

## MCP / CLI Usage

```bash
# MCP server (stdio)
node dist/cli.js --mcp

# CLI
sql-preview-snowflake --query "SELECT CURRENT_TIMESTAMP()" \
  --config $(echo '{"account":"myorg-myaccount","username":"sqladmin","password":"P@ssw0rd","warehouse":"COMPUTE_WH"}' | base64)
```

## Development

```bash
npm install
npm test          # unit tests (mocked, no Snowflake account needed)
npm run build
```
