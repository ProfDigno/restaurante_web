@echo off
setlocal
title Restaurante Web - Desarrollo

cd /d "%~dp0"

echo.
echo ========================================
echo     RESTAURANTE WEB - DESARROLLO
echo ========================================
echo.

if not exist "package.json" (
  echo ERROR: No se encontro package.json en la carpeta del proyecto.
  goto :error
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta disponible en PATH.
  goto :error
)

rem "where" busca en el PATH al instante; "npm --version" tardaba unos 7 segundos.
set "PKG_RUNNER=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  set "PKG_RUNNER=npm"
  where npm >nul 2>nul
  if errorlevel 1 (
    echo ERROR: No se encontro pnpm ni npm en PATH.
    goto :error
  )
)
echo Gestor de paquetes: %PKG_RUNNER%

if not exist ".env" (
  if not exist ".env.example" (
    echo ERROR: Falta .env y no existe .env.example.
    goto :error
  )
  copy /Y ".env.example" ".env" >nul
  echo Se creo .env. Configura DB_PASSWORD y JWT_SECRET antes de iniciar.
  goto :error
)

if not exist "node_modules\vite" (
  echo Instalando dependencias...
  if "%PKG_RUNNER%"=="pnpm" (
    call pnpm install --frozen-lockfile
  ) else (
    call npm install --no-package-lock
  )
  if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias.
    goto :error
  )
)

set "NODE_ENV=development"
echo.
echo Iniciando en modo desarrollo con recarga automatica.
echo Puerto configurado en .env (3000 por defecto).
echo Para detenerla, cierra esta ventana o presiona Ctrl+C.
echo.
call %PKG_RUNNER% run dev
if errorlevel 1 (
  echo ERROR: El servidor finalizo con un error.
  goto :error
)
exit /b 0

:error
echo.
pause
exit /b 1
