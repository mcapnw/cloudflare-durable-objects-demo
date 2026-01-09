# deploy-all.ps1 - Full deployment script that auto-increments version, syncs to DB, and deploys

Write-Host "=== Antigravity Full Deploy ===" -ForegroundColor Cyan

$constantsFile = "app/islands/game-canvas/constants.ts"
$content = Get-Content $constantsFile -Raw

# Extract current version
if ($content -match "CLIENT_VERSION = '([^']+)'") {
    $currentVersion = $matches[1]
    Write-Host "Current version: $currentVersion" -ForegroundColor Yellow
    
    # Parse and increment patch version (X.Y.Z -> X.Y.Z+1)
    $versionParts = $currentVersion -split '\.'
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    $patch = [int]$versionParts[2] + 1
    $newVersion = "$major.$minor.$patch"
    
    Write-Host "Incrementing to: $newVersion" -ForegroundColor Green
    
    # Update constants.ts with new version
    $newContent = $content -replace "CLIENT_VERSION = '[^']+'", "CLIENT_VERSION = '$newVersion'"
    Set-Content -Path $constantsFile -Value $newContent -NoNewline
    Write-Host "Updated $constantsFile" -ForegroundColor Green
    
    $version = $newVersion
} else {
    Write-Host "ERROR: Could not find CLIENT_VERSION in $constantsFile" -ForegroundColor Red
    exit 1
}

# Deploy Pages application
Write-Host "Deploying Pages application..." -ForegroundColor Yellow
npm run deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Pages deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "Pages deployed!" -ForegroundColor Green

# Deploy Durable Object worker
Write-Host "Deploying Durable Object worker..." -ForegroundColor Yellow
npx wrangler deploy -c wrangler-do.toml
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Durable Object deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "Durable Object deployed!" -ForegroundColor Green

# Update database version (After deployments to prevent premature client refreshes)
Write-Host "Updating database version to $version..." -ForegroundColor Yellow
npx wrangler d1 execute antigravity-db --remote --command="INSERT OR REPLACE INTO GameConfig (key, value) VALUES ('version', '$version')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to update database version" -ForegroundColor Red
    exit 1
}
Write-Host "Database version updated!" -ForegroundColor Green

Write-Host ""
Write-Host "=== Deployment Complete! ===" -ForegroundColor Cyan
Write-Host "Version $version is now live." -ForegroundColor Green
