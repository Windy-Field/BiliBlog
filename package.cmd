@echo off
setlocal
title BiliBlog Submission

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\pack-submission.ps1"
set "packageExitCode=%errorlevel%"

echo.
if not "%packageExitCode%"=="0" (
    echo Packaging failed. Check the message above.
) else (
    echo The submission ZIP is ready in the submissions folder.
)
pause
exit /b %packageExitCode%
