#!/usr/bin/pwsh

$PSNativeCommandUseErrorActionPreference = $true
$ErrorActionPreference = 'Stop'

pnpm ts-node .\scripts\compile.ts .\assets\colr\ .\assets\mono\ .\assets\extras\ .\obj\ 'Seagull Flags'
pnpm grunt webfont

python .\scripts\patch.py '.\obj\raw\Seagull Flags.ttf'
ffpython .\scripts\patch.ff.py '.\obj\raw\Seagull Flags.ttf'
ttx -m '.\obj\raw\Seagull Flags.ttf' -o '.\obj\Seagull Flags.ttf' '.\obj\Seagull Flags.ttx'
