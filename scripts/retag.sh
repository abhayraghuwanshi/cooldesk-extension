#!/bin/bash
# Usage: ./scripts/retag.sh v1.0.0

set -e

TAG=$1

if [ -z "$TAG" ]; then
  echo "Usage: $0 <tag>  (e.g. $0 v1.0.0)"
  exit 1
fi

echo "Retagging $TAG..."

# Delete local tag if it exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  git tag -d "$TAG"
  echo "Deleted local tag $TAG"
fi

# Delete remote tag if it exists
if git ls-remote --tags origin | grep -q "refs/tags/$TAG$"; then
  git push origin ":refs/tags/$TAG"
  echo "Deleted remote tag $TAG"
fi

# Create fresh tag on current commit
git tag "$TAG"
git push origin "$TAG"

echo "Done — $TAG now points to $(git rev-parse --short HEAD) and CI is running"
