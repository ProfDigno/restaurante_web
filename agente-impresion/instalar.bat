@echo off
setlocal
title Instalar agente de impresion - Restaurante Web
cd /d "%~dp0"

echo.
echo ================================================
echo    AGENTE DE IMPRESION - RESTAURANTE WEB
echo ================================================
echo.

rem Si se abrio instalar.bat desde adentro del ZIP (sin descomprimir), Windows solo copia este archivo a una
rem carpeta temporal. En ese caso se busca el ZIP en Descargas, se descomprime y se sigue desde ahi.
if not exist "agente-impresion.jar" if exist "dist\agente-impresion.jar" copy /Y "dist\agente-impresion.jar" "agente-impresion.jar" >nul
if not exist "agente-impresion.jar" (
  echo No se encontro agente-impresion.jar junto a instalar.bat.
  echo Buscando agente-impresion.zip en Descargas para descomprimirlo...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$z = Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter 'agente-impresion*.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $z) { exit 2 }; $d = Join-Path $env:TEMP 'agente-impresion-instalar'; Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive -LiteralPath $z.FullName -DestinationPath $d -Force; Write-Host ('Descomprimido: ' + $z.Name)"
  if errorlevel 1 (
    echo.
    echo ERROR: No se encontro el ZIP del agente.
    echo Haga clic derecho en agente-impresion.zip, elija "Extraer todo..." y ejecute
    echo instalar.bat desde la carpeta extraida.
    goto :error
  )
  if not exist "%TEMP%\agente-impresion-instalar\agente-impresion\instalar.bat" (
    echo ERROR: El ZIP no tiene el formato esperado. Descarguelo de nuevo desde el sistema.
    goto :error
  )
  call "%TEMP%\agente-impresion-instalar\agente-impresion\instalar.bat"
  exit /b %errorlevel%
)

rem Busca Java: primero en el PATH y luego en JAVA_HOME.
set "JAVA="
set "JAVAW="
for /f "delims=" %%i in ('where java 2^>nul') do if not defined JAVA set "JAVA=%%i"
for /f "delims=" %%i in ('where javaw 2^>nul') do if not defined JAVAW set "JAVAW=%%i"
if not defined JAVA if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set "JAVA=%JAVA_HOME%\bin\java.exe"
if not defined JAVAW if defined JAVA_HOME if exist "%JAVA_HOME%\bin\javaw.exe" set "JAVAW=%JAVA_HOME%\bin\javaw.exe"
if not defined JAVA (
  echo ERROR: No se encontro Java en esta PC.
  echo Instale Java 8 o superior y vuelva a ejecutar instalar.bat.
  goto :error
)
if not defined JAVAW set "JAVAW=%JAVA%"

rem Comprueba que este Java (8 o superior) puede ejecutar el agente.
"%JAVA%" -jar "agente-impresion.jar" --version
if errorlevel 1 (
  echo ERROR: El Java instalado no puede ejecutar el agente. Se necesita Java 8 o superior.
  goto :error
)

set "DEST=%LOCALAPPDATA%\RestauranteAgenteImpresion"
echo.
echo Instalando en %DEST%

rem Cierra el agente si ya estaba abierto (para poder reemplazar el .jar).
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*agente-impresion.jar*' -and $_.Name -like 'java*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

if not exist "%DEST%" mkdir "%DEST%"
copy /Y "agente-impresion.jar" "%DEST%\agente-impresion.jar" >nul
copy /Y "desinstalar.bat" "%DEST%\desinstalar.bat" >nul
copy /Y "LEEME.txt" "%DEST%\LEEME.txt" >nul
if exist "%DEST%\config.properties" (
  copy /Y "%DEST%\config.properties" "%DEST%\config.anterior.properties" >nul
  echo Configuracion anterior guardada en config.anterior.properties
)
copy /Y "config.properties" "%DEST%\config.properties" >nul

rem Acceso directo en Inicio de Windows: el agente arranca solo, sin ventana.
set "INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:INICIO + '\Agente de impresion Restaurante.lnk'); $s.TargetPath=$env:JAVAW; $s.Arguments='-jar \"' + $env:DEST + '\agente-impresion.jar\"'; $s.WorkingDirectory=$env:DEST; $s.Description='Agente de impresion de Restaurante Web'; $s.Save()"
if errorlevel 1 (
  echo AVISO: No se pudo crear el acceso en Inicio de Windows. El agente no arrancara solo al prender la PC.
)

start "" "%JAVAW%" -jar "%DEST%\agente-impresion.jar"

echo.
echo Listo. El agente quedo instalado y abierto (icono de impresora junto al reloj).
echo Arranca solo cada vez que se inicia Windows.
echo Panel del agente: http://127.0.0.1:9123/
echo.
pause
exit /b 0

:error
echo.
pause
exit /b 1
