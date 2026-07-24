#!/usr/bin/env bash
# Build (and optionally push) the MailMind Workspace MCP image.
#
# Usage:
#   ./scripts/build-mcp-image.sh
#   ./scripts/build-mcp-image.sh --push YOURDOCKERHUB/mailmind-workspace-mcp:latest
#   REGISTRY=ghcr.io/YOURORG ./scripts/build-mcp-image.sh --push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_LOCAL="${IMAGE_LOCAL:-mailmind-workspace-mcp:latest}"
PUSH_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      if [[ $# -ge 2 && ! "$2" =~ ^-- ]]; then
        PUSH_TAG="$2"
        shift 2
      else
        PUSH_TAG="${REGISTRY:-mailmind-workspace-mcp}:latest"
        shift
      fi
      ;;
    *)
      echo "Unknown arg: $1"
      exit 1
      ;;
  esac
done

echo "Building $IMAGE_LOCAL from Dockerfile.mcp ..."
docker build -f Dockerfile.mcp -t "$IMAGE_LOCAL" .

if [[ -n "$PUSH_TAG" ]]; then
  echo "Tagging as $PUSH_TAG ..."
  docker tag "$IMAGE_LOCAL" "$PUSH_TAG"
  echo "Pushing $PUSH_TAG ..."
  docker push "$PUSH_TAG"
  echo "Done. Pull on any host with: docker pull $PUSH_TAG"
else
  echo "Done. Run with:"
  echo "  docker run --rm -p 8000:8000 \\"
  echo "    --env-file .env \\"
  echo "    -e GOOGLE_OAUTH_CLIENT_ID=\"\$GOOGLE_CLIENT_ID\" \\"
  echo "    -e GOOGLE_OAUTH_CLIENT_SECRET=\"\$GOOGLE_CLIENT_SECRET\" \\"
  echo "    -e MCP_ENABLE_OAUTH21=true \\"
  echo "    -e EXTERNAL_OAUTH21_PROVIDER=true \\"
  echo "    -e WORKSPACE_MCP_STATELESS_MODE=true \\"
  echo "    $IMAGE_LOCAL"
fi
