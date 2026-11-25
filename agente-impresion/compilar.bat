@echo off
setlocal
rem Compila el agente (Java 8) en dist\agente-impresion.jar, con PDFBox incluido. Requiere un JDK 8 o superior.
cd /d "%~dp0"

if exist build rmdir /s /q build
mkdir build\classes
if not exist dist mkdir dist

javac -encoding UTF-8 -source 8 -target 8 -nowarn -cp "lib\*" -d build\classes src\agente\*.java
if errorlevel 1 goto :error
copy /Y src\agente\panel.html build\classes\agente\panel.html >nul

rem Incluye las librerias dentro del jar (un solo archivo para instalar).
pushd build\classes
for %%j in (..\..\lib\*.jar) do jar xf "%%j"
if exist META-INF\MANIFEST.MF del META-INF\MANIFEST.MF
del /q META-INF\*.SF META-INF\*.RSA META-INF\*.DSA 2>nul
popd

> build\manifest.txt echo Main-Class: agente.Agente
jar cfm dist\agente-impresion.jar build\manifest.txt -C build\classes .
if errorlevel 1 goto :error
rmdir /s /q build
echo Listo: dist\agente-impresion.jar
exit /b 0

:error
echo ERROR: no se pudo compilar el agente.
exit /b 1
