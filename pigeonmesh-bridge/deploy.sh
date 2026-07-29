#!/usr/bin/env bash
# Deploy PigeonMesh Cloud Bridge to Vercel.
# Run: ./deploy.sh
set -e
echo "🚀 Deploying PigeonMesh Cloud Bridge to Vercel..."
npm install -g vercel 2>/dev/null || true
vercel --prod
echo ""
echo "✅ Deployed! Note your URL above."
echo "Add it to your router: LuCI → Services → PigeonMesh → Settings → Bridge URL"
