@echo off
setlocal
title biliblog

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\start-dev.ps1" -OpenBrowser

if errorlevel 1 (
    echo.
    echo biliblog could not start. Check the message above.
    pause
    exit /b 1
)

exit /b 0
