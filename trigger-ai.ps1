# Manual trigger script for Workers AI
# This will generate a news article immediately

Write-Host "Triggering Workers AI article generation..." -ForegroundColor Cyan

# Get the DO_SECRET from wrangler
$secretOutput = npx wrangler secret get DO_SECRET -c wrangler-do.toml 2>&1 | Out-String
$secret = ($secretOutput -split "`n" | Where-Object { $_ -match '\S' } | Select-Object -First 1).Trim()

if (-not $secret) {
    Write-Host "Error: Could not retrieve DO_SECRET" -ForegroundColor Red
    exit 1
}

Write-Host "Secret retrieved successfully" -ForegroundColor Green
Write-Host "Calling trigger endpoint..." -ForegroundColor Cyan

# Call the trigger endpoint
$response = curl -X GET "https://antigravity-do.avjl.workers.dev/trigger-workers-ai" `
    -H "X-DO-SECRET: $secret" `
    -w "\nHTTP Status: %{http_code}" `  
    -s

Write-Host $response -ForegroundColor Yellow
Write-Host ""
Write-Host "Check logs with: npx wrangler tail -c wrangler-do.toml --format pretty" -ForegroundColor Cyan
Write-Host "Check database with: npx wrangler d1 execute antigravity-db --remote --command 'SELECT headline FROM NewsPosts ORDER BY created_at DESC LIMIT 3'" -ForegroundColor Cyan
