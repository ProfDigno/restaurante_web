@echo off
setlocal
title Desinstalar agente de impresion - Restaurante Web

echo Cerrando el agente de impresion...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*agente-impresion.jar*' -and $_.Name -like 'java*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Agente de impresion Restaurante.lnk" >nul 2>nul

set "DEST=%LOCALAPPDATA%\RestauranteAgenteImpresion"
echo.
echo El agente ya no arranca con Windows.
echo Para borrar tambien sus archivos (cola, logs y configuracion), elimine la carpeta:
echo   %DEST%
echo.
pause
