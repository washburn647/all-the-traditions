# Daily link-matching run, started by the Windows scheduled task
# "All the Traditions link matching". Each step stops on its own when the
# service's daily allowance is used up; results are pushed to GitHub.
# Log: tools\cache\daily.log
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot)
$py  = 'C:\Users\Kyle\AppData\Local\Programs\Python\Python312\python.exe'
$git = 'C:\Program Files\Git\cmd\git.exe'
$log = 'tools\cache\daily.log'
New-Item -ItemType Directory -Force tools\cache | Out-Null
$env:PYTHONIOENCODING = 'utf-8'

"`n=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" | Add-Content $log
& $py tools\match.py spotify --limit 500 *>> $log
& $py tools\match.py archive --limit 300 *>> $log
& $py tools\match.py youtube *>> $log
& $py tools\match.py report *>> $log

& $git add data/links.json *>> $log
& $git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    & $git commit -q -m "Daily link matching $(Get-Date -Format 'yyyy-MM-dd')" *>> $log
    & $git push -q origin main *>> $log
}
