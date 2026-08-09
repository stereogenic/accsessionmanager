@echo off
title ACC Session Manager

:: Check if port 3030 is already open and listening
netstat -ano | findstr ":3030" | findstr "LISTENING" >NUL
if %ERRORLEVEL% equ 0 (
    echo ACC Session Manager is already running. Opening GUI...
    start "" "http://localhost:3030"
    exit /b
)

:: Open the default Windows browser
start "" "http://localhost:3030"

:: Launch Node.js completely hidden
powershell -WindowStyle Hidden -Command "Start-Process '%~dp0bin\node.exe' -ArgumentList '%~dp0bin\gui.js' -WorkingDirectory '%~dp0bin' -WindowStyle Hidden -Wait"

:: Exit the command prompt
exit /b