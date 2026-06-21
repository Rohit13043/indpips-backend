@echo off
title INDPIPS - push to GitHub
cd /d "%~dp0"
echo Pushing the INDPIPS project to GitHub...
echo (node_modules and secrets are excluded automatically by .gitignore)
echo.
git init -b main
git add .
git -c user.email=dev@indpips.com -c user.name=INDPIPS commit -m "INDPIPS platform"
git remote remove origin 2>nul
git remote add origin https://github.com/Rohit13043/indpips-backend.git
git push -u origin main --force
echo.
echo If a GitHub sign-in window appeared, approve it.
echo Success when you see:  branch 'main' set up to track 'origin/main'
pause
