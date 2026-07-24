#!/usr/bin/env bash
# Recommended local MCP for MailMind (no Docker image pull).
# Requires: uv (brew install uv). Uses GOOGLE_CLIENT_* from .env.
#
#   npm run mcp:start
#   WORKSPACE_MCP_URL=http://localhost:8000/mcp
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and fill Google credentials."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${GOOGLE_CLIENT_ID:-}" || -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  echo "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env"
  exit 1
fi

export GOOGLE_OAUTH_CLIENT_ID="$GOOGLE_CLIENT_ID"
export GOOGLE_OAUTH_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
export MCP_ENABLE_OAUTH21=true
export EXTERNAL_OAUTH21_PROVIDER=true
export WORKSPACE_MCP_STATELESS_MODE=true
export OAUTHLIB_INSECURE_TRANSPORT=1

echo "Starting google_workspace_mcp on http://0.0.0.0:8000/mcp"
echo "Point WORKSPACE_MCP_URL at http://localhost:8000/mcp"

exec uvx workspace-mcp \
  --transport streamable-http \
  --tools gmail drive calendar sheets docs contacts \
  --tool-tier extended
