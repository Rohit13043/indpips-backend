@echo off
title INDPIPS backend
cd /d "%~dp0"
echo Building and starting the INDPIPS backend with Docker...
echo (first run downloads and builds — this can take a few minutes)
docker compose up -d --build
echo.
echo Done. The API should be live at http://localhost:4000/health
echo To stop it later, run:  docker compose down
pause
