@echo off
title INDPIPS dashboard (static server)
cd /d "%~dp0"
echo Serving this folder at http://localhost:8080
echo Open http://localhost:8080/dashboard.html  or  /admin.html
py -m http.server 8080 2>nul || python -m http.server 8080
