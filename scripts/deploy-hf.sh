#!/usr/bin/env bash
# Deploys the monorepo to a Hugging Face Docker Space.
#
# One-time setup:
#   1. Create a Space at https://huggingface.co/new-space -> SDK: Docker (blank)
#   2. git remote add hf https://huggingface.co/spaces/<USER>/<SPACE>
#   3. Set these secrets in Space Settings -> Variables and secrets:
#        DATABASE_URL        (Neon connection string, sslmode=require)
#        JWT_PRIVATE_KEY     (PEM, multiline)
#        JWT_PUBLIC_KEY      (PEM, multiline)
#        ADMIN_BOOTSTRAP_EMAIL
#
# Every deploy afterwards:
#   scripts/deploy-hf.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch origin main >/dev/null 2>&1 || true
CURRENT=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT" != "hf" ]; then
  git checkout hf 2>/dev/null || git checkout -b hf origin/main
  # Fast-forward the hf branch to current main before patching README.
  git merge --ff-only "origin/$CURRENT" 2>/dev/null || git merge --ff-only "$CURRENT"
fi

# HF requires README.md frontmatter at the repo root; swap it in on this branch only.
cp scripts/README.hf.md README.md
git add README.md
git diff --cached --quiet || git commit -m "hf: space metadata"

git push hf hf:main
echo "Pushed to HF. Switching back to $CURRENT..."
git checkout "$CURRENT"
