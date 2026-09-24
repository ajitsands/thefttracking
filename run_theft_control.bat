@echo off
TITLE Supermarket AI CCTV Theft Control & Prevention System
COLOR 0A

echo ===============================================================================
echo     [AEGISVISION] SUPERMARKET CCTV AI THEFT PREVENTION & CONTROL CENTER
echo ===============================================================================
echo.
echo [*] Isolating environment to E:\theftcontrol\WorkingFiles (C: Drive Protected)...
SET PIP_CACHE_DIR=E:\theftcontrol\WorkingFiles\pip_cache
SET PYTHONPYCACHEPREFIX=E:\theftcontrol\WorkingFiles\pycache

echo [*] Initializing Database & AI Detection Engine...
cd /d "E:\theftcontrol"

echo [*] Starting Web Server at http://localhost:5000...
start "" "http://localhost:5000"

"E:\theftcontrol\WorkingFiles\venv\Scripts\python.exe" app.py

pause
