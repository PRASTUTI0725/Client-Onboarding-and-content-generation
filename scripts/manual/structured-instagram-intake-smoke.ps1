param(
  [string]$ApiUrl = $(if ($env:E2E_API_URL) { $env:E2E_API_URL } else { "http://127.0.0.1:3001/api" }),
  [string]$ApiKey = $(if ($env:E2E_API_KEY) { $env:E2E_API_KEY } else { "sk-content-calendar-test-2026" })
)

$ApiUrl = $ApiUrl.TrimEnd("/")
$Headers = @{
  "x-api-key" = $ApiKey
  "Content-Type" = "application/json"
}

function Invoke-ApiJson {
  param(
    [string]$Method,
    [string]$Url,
    [object]$Body = $null
  )
  $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 20 } else { $null }
  if ($null -ne $json) {
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers
}

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$structuredInstagram = @{
  handle = "@manual_structured_$suffix"
  bio = "Instagram-first strategy studio helping founder-led brands grow with clear messaging and content systems."
  offerSummary = "We sell Instagram strategy, positioning, and repeatable content planning."
  recentCaptionSnippets = @(
    "Why most founder brands sound the same on Instagram and how to fix it."
    "Behind the scenes of rebuilding a service brand's content system."
    "Three messaging mistakes that keep premium service brands invisible."
    "Client win: from random posts to a repeatable Instagram narrative."
  )
  recurringTopics = @(
    "Instagram strategy"
    "founder-led brands"
    "content systems"
  )
  ctaPatterns = @("DM START for details")
  proofSignals = @("Client win breakdowns")
  followerCount = "12.4K"
  category = "Marketing Agency"
  visualStyleNotes = "Minimal, editorial layouts with clear high-contrast reels covers."
}

$approvedSow = @{
  sowVersion = 2
  industry = "Social media marketing"
  targetAudience = "Founder-led service brands that want a stronger Instagram presence."
  understandingOfRequirements = "Client needs a clear Instagram-first strategy, better positioning, and repeatable content execution."
  strategyLaunchPlanning = "Build an Instagram-first strategy, tighten positioning, and roll out monthly content themes."
  contentCreation = "Instagram-first content planning, hooks, proof-led messaging, and recurring topic guidance."
  scopeOfWork = "Instagram strategy, positioning, content planning, and monthly content system support."
  approval = @{
    approved = $true
    approvedAt = [DateTime]::UtcNow.ToString("o")
  }
  platforms = @("Instagram")
  monthlyPosts = @{ Instagram = 16 }
  contentMix = @{
    education = 6
    thought_leadership = 5
    social_proof = 3
    promotion = 2
  }
  deliverables = @()
  toneByPlatform = @{ Instagram = "Clear, warm, strategic" }
}

Write-Host "`n== Structured client create ==" -ForegroundColor Cyan
$structuredClient = Invoke-ApiJson -Method POST -Url "$ApiUrl/clients" -Body @{
  name = "Structured Intake Manual $suffix"
  websiteUrl = "https://structured-$suffix.example"
  instagramHandle = "@seed_structured"
  oneLineDescription = "Manual verification client for structured Instagram intake."
}
$structuredClientId = $structuredClient.id
Write-Host "Client ID: $structuredClientId"

Write-Host "`n== Structured client save + approve ==" -ForegroundColor Cyan
$structuredSow = $approvedSow.Clone()
$structuredSow.instagram = $structuredInstagram
Invoke-ApiJson -Method PUT -Url "$ApiUrl/clients/$structuredClientId/sow" -Body $structuredSow | Out-Null
$structuredDetail = Invoke-ApiJson -Method GET -Url "$ApiUrl/clients/$structuredClientId"
$structuredSnapshotIg = $structuredDetail.client.sow.__approvedContextSnapshot.sow.instagram
Write-Host "Approved snapshot instagram handle: $($structuredSnapshotIg.handle)"

Write-Host "`n== Structured client rebuild ==" -ForegroundColor Cyan
Invoke-ApiJson -Method POST -Url "$ApiUrl/clients/$structuredClientId/onboarding/business-dna/rebuild" | Out-Null
$afterRebuild = Invoke-ApiJson -Method GET -Url "$ApiUrl/clients/$structuredClientId"
$dnaInstagram = $afterRebuild.onboarding.enrichedData.businessDna.platformSignals.instagram
Write-Host "Business DNA instagram handle: $($dnaInstagram.handle)"

Write-Host "`n== Legacy-only client create + SOW update without structured Instagram ==" -ForegroundColor Cyan
$legacyClient = Invoke-ApiJson -Method POST -Url "$ApiUrl/clients" -Body @{
  name = "Legacy Only Manual $suffix"
  websiteUrl = "https://legacy-$suffix.example"
  instagramHandle = "@legacy_seed"
  oneLineDescription = "Legacy-only verification client."
}
$legacyClientId = $legacyClient.id
Invoke-ApiJson -Method PUT -Url "$ApiUrl/clients/$legacyClientId/sow" -Body $approvedSow | Out-Null
Invoke-ApiJson -Method PATCH -Url "$ApiUrl/clients/$legacyClientId/onboarding" -Body @{
  instagramSummaryNotes = "Legacy notes only: founder-led service brand, DM CTA, proof-led messaging."
} | Out-Null
$legacyDetail = Invoke-ApiJson -Method GET -Url "$ApiUrl/clients/$legacyClientId"
Write-Host "Legacy snapshot instagram exists: $([bool]$legacyDetail.client.sow.__approvedContextSnapshot.sow.instagram)"
Write-Host "Legacy raw notes: $($legacyDetail.onboarding.rawInput.instagramSummaryNotes)"

Write-Host "`n== Onboarding PATCH body.instagram override ==" -ForegroundColor Cyan
$overrideBodyA = @{
  instagram = @{
    handle = "@override_a"
    bio = "Bio A"
    offerSummary = "Offer A"
    recentCaptionSnippets = @("Caption A1", "Caption A2", "Caption A3", "Caption A4")
    recurringTopics = @("Topic A1", "Topic A2", "Topic A3")
  }
}
Invoke-ApiJson -Method PATCH -Url "$ApiUrl/clients/$legacyClientId/onboarding" -Body $overrideBodyA | Out-Null
$overrideBodyB = @{
  instagram = @{
    handle = "@partial_stub_only"
  }
  instagramSummaryNotes = "Partial structured input with legacy notes fallback."
}
Invoke-ApiJson -Method PATCH -Url "$ApiUrl/clients/$legacyClientId/onboarding" -Body $overrideBodyB | Out-Null
$afterPatch = Invoke-ApiJson -Method GET -Url "$ApiUrl/clients/$legacyClientId"
$rawInstagram = $afterPatch.onboarding.rawInput.instagram
Write-Host "Raw input instagram handle after override: $($rawInstagram.handle)"
Write-Host "Raw input legacy notes after override: $($afterPatch.onboarding.rawInput.instagramSummaryNotes)"

Write-Host "`n== Summary ==" -ForegroundColor Green
[PSCustomObject]@{
  StructuredClientId = $structuredClientId
  LegacyClientId = $legacyClientId
  StructuredSnapshotInstagramHandle = $structuredSnapshotIg.handle
  RebuiltBusinessDnaInstagramHandle = $dnaInstagram.handle
  LegacySnapshotInstagramPresent = [bool]$legacyDetail.client.sow.__approvedContextSnapshot.sow.instagram
  RawInstagramHandleAfterOverride = $rawInstagram.handle
} | Format-List
