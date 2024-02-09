#!/usr/bin/pwsh

$PSNativeCommandUseErrorActionPreference = $true
$ErrorActionPreference = 'Stop'

pnpm ts-node .\scripts\compile.ts .\assets\colr\ .\assets\mono\ .\assets\extras\ .\bin\ 'Seagull Flags'
pnpm grunt webfont

python .\scripts\patch.py '.\bin\raw\Seagull Flags.ttf'
ffpython .\scripts\patch.ff.py '.\bin\raw\Seagull Flags.ttf'
ttx -m '.\bin\raw\Seagull Flags.ttf' -o '.\bin\Seagull Flags.ttf' '.\bin\Seagull Flags.ttx'
