---
description: Deploy the full application (Pages + Durable Objects + version sync)
---

When the user says "full deploy", "deploy all", "release", or "ship it", run the deploy-all script:

// turbo
1. Run the full deploy script:
```powershell
.\deploy-all.ps1
```

This script automatically:
- Reads CLIENT_VERSION from `app/islands/game-canvas/constants.ts`
- Updates the database GameConfig.version to match
- Deploys the Pages application
- Deploys the Durable Object worker

## If the user wants to increment the version first:

1. Update `CLIENT_VERSION` in `app/islands/game-canvas/constants.ts`
2. Then run `.\deploy-all.ps1`

## Individual deploy commands (if needed separately):

- Pages only: `npm run deploy`
- Durable Object only: `npx wrangler deploy -c wrangler-do.toml`
- Database version only: `npx wrangler d1 execute antigravity-db --remote --command="INSERT OR REPLACE INTO GameConfig (key, value) VALUES ('version', 'X.X.X')"`
