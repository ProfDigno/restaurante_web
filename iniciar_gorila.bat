@echo off
rem Inicia el sistema con la base importada de Gorila (bdrestaurante_gorila) en el puerto 3002,
rem para poder usarlo al mismo tiempo que la base actual (puerto 3000).
rem Las variables de entorno tienen prioridad sobre el archivo .env.
set "DB_NAME=bdrestaurante_gorila"
set "PORT=3002"
title Restaurante Web - GORILA (puerto 3002)
call "%~dp0iniciar_restaurante.bat"
