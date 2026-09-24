@echo off
TITLE Stop Supermarket AI CCTV Theft Control
COLOR 0C

echo ===============================================================================
echo     STOPPING AEGISVISION THEFT CONTROL & RELEASING ALL CAMERAS
echo ===============================================================================
echo.
echo [*] Stopping background Python processes...
powershell -Command "Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*theftcontrol*' } | Stop-Process -Force"

echo [*] Releasing camera hardware and turning off camera LED light...
powershell -Command "Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force"

echo.
echo [SUCCESS] Application stopped completely! Camera light is now OFF.
echo.
pause
