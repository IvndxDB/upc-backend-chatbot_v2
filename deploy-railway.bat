@echo off
echo Deploying backend to Railway...
cd /d "%~dp0upc-backend-clean"
railway up --detach
echo Done! Check Railway dashboard for build status.
pause
