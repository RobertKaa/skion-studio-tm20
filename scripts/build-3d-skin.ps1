# Compile un skin 3D TM2020 : NadeoImporter puis skinfix.
# Ne relancer que quand la FORME change. La peinture se fait dans l'app.
#
#   powershell -File scripts/build-3d-skin.ps1 -ProjectDir work/citrouille
#
# Le dossier projet doit contenir MainBody.fbx (ou body.fbx) et preview.glb,
# produits par scripts/blender/skin3d_blender.py. materials.json est facultatif.
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = $PSScriptRoot | Split-Path -Parent
}

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

$ConfigPath = Join-Path $Root "scripts\3d-skin.local.json"
if (-not (Test-Path $ConfigPath)) {
  Fail "Créez scripts/3d-skin.local.json à partir de scripts/3d-skin.local.example.json (chemins Trackmania, NadeoImporter, skinfix)."
}
$cfg = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json

$Project = Resolve-Path $ProjectDir
$fbx = Join-Path $Project "MainBody.fbx"
if (-not (Test-Path $fbx)) { $fbx = Join-Path $Project "body.fbx" }
if (-not (Test-Path $fbx)) { Fail "MainBody.fbx introuvable dans $Project" }
$glb = Join-Path $Project "preview.glb"
if (-not (Test-Path $glb)) { Fail "preview.glb introuvable dans $Project" }

$tm = [string]$cfg.tmInstallPath
if (-not $tm -or -not (Test-Path $tm)) { Fail "tmInstallPath invalide dans 3d-skin.local.json" }
$importer = [string]$cfg.nadeoImporter
if (-not $importer) { $importer = Join-Path $tm "NadeoImporter.exe" }
if (-not (Test-Path $importer)) { Fail "NadeoImporter introuvable : $importer" }
$skinfix = [string]$cfg.skinfix
if (-not $skinfix -or -not (Test-Path $skinfix)) { Fail "skinfix introuvable : $skinfix" }

$docs = [string]$cfg.documents
if (-not $docs) {
  foreach ($name in @("Trackmania", "Trackmania2020")) {
    $candidate = Join-Path $env:USERPROFILE "Documents\$name"
    if (Test-Path $candidate) { $docs = $candidate; break }
  }
}
if (-not $docs -or -not (Test-Path $docs)) {
  Fail "Dossier Documents\Trackmania introuvable. Renseignez `"documents`" dans 3d-skin.local.json."
}

$name = Split-Path $Project -Leaf
$work = Join-Path $docs "Work\tm-skin\$name"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$workFbx = Join-Path $work "MainBody.fbx"
Copy-Item $fbx $workFbx -Force

$materials = @(
  "SkinDmg_Skin",
  "DetailsDmgNormal_Details",
  "DetailsDmgNormal_Wheels",
  "GlassDmgCrack_Glass"
)
$matFile = Join-Path $Project "materials.json"
if (Test-Path $matFile) {
  $parsed = Get-Content -Raw -Path $matFile | ConvertFrom-Json
  if ($parsed) { $materials = @($parsed) }
}

function Model-Of([string]$MatName) {
  foreach ($prefix in @(
      "SkinDmg_", "DetailsDmgNormal_", "GlassDmgCrack_", "GlassDmgDecal_",
      "DetailsDmgDecal_", "SkinDmgDecal_", "Gems_", "GlassRefract_"
    )) {
    if ($MatName.StartsWith($prefix)) { return $prefix.TrimEnd("_") }
  }
  return "DetailsDmgNormal"
}

$xmlPath = Join-Path $work "MainBody.MeshParams.xml"
$matXml = ($materials | ForEach-Object {
    $model = Model-Of $_
    "    <Material Name=`"$_`" Model=`"$model`" />"
  }) -join "`n"
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($xmlPath, @"
<?xml version="1.0" encoding="utf-8"?>
<MeshParams MeshType="Vehicle" SkelSocketPrefix="_">
  <Materials>
$matXml
  </Materials>
  <Constants />
  <UvAnims />
  <VisibleIds />
  <Color />
</MeshParams>
"@, $utf8)

$importerDir = Split-Path $importer -Parent
$iniBeside = Join-Path $importerDir "Nadeo.ini"
$iniGame = Join-Path $tm "Nadeo.ini"
if (-not (Test-Path $iniBeside) -and (Test-Path $iniGame)) {
  Copy-Item $iniGame $iniBeside -Force
}

$relative = "tm-skin\$name\MainBody.fbx"
Write-Host "NadeoImporter Mesh $relative"
Push-Location $tm
try {
  & $importer Mesh $relative
  if ($LASTEXITCODE -ne 0) { Fail "NadeoImporter a échoué (code $LASTEXITCODE)." }
}
finally { Pop-Location }

$produced = Join-Path $docs "tm-skin\$name\MainBody.Mesh.gbx"
if (-not (Test-Path $produced)) {
  $produced = Join-Path $work "MainBody.Mesh.gbx"
}
if (-not (Test-Path $produced)) { Fail "MainBody.Mesh.gbx introuvable après NadeoImporter." }

$outDir = Split-Path $produced -Parent
$fixed = Join-Path $outDir "MainBody.Fixed.gbx"
Write-Host "skinfix $produced"
& $skinfix $produced -o $fixed
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $fixed)) {
  & $skinfix $produced --out $fixed
}
if (-not (Test-Path $fixed)) { Fail "skinfix n'a pas écrit $fixed" }

$meshOut = Join-Path $Project "MainBody.Mesh.gbx"
Copy-Item $fixed $meshOut -Force

$meta = @{ name = $name; created = (Get-Date).ToString("o") } | ConvertTo-Json
Set-Content -Path (Join-Path $Project "skin3d.json") -Value $meta -Encoding UTF8

$zipPath = Join-Path $Project "skin3d-project.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
$stage = Join-Path $Project "_zipstage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item $glb (Join-Path $stage "preview.glb") -Force
Copy-Item $meshOut (Join-Path $stage "MainBody.Mesh.gbx") -Force
Copy-Item (Join-Path $Project "skin3d.json") (Join-Path $stage "skin3d.json") -Force
Get-ChildItem $Project -Filter *.dds | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $stage $_.Name) -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath
Remove-Item $stage -Recurse -Force

Write-Host "Projet prêt : $zipPath"

$tsx = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
$gameZipScript = Join-Path $Root "scripts\pack-default-game-zip.ts"
if ((Test-Path $tsx) -and (Test-Path $gameZipScript)) {
  & node $tsx $gameZipScript $Project
  if ($LASTEXITCODE -ne 0) { Fail "Le zip de jeu (gris par défaut) n'a pas été écrit." }
  Write-Host "Zip de jeu (gris, sans peinture) : $(Join-Path $Project "$name.zip")"
  Write-Host "C'est ce fichier qui va dans Documents\Trackmania\Skins\Models\CarSport\."
} else {
  Write-Host "Importez le zip projet dans TM Skin Studio pour peindre, puis exportez le skin de jeu."
}
