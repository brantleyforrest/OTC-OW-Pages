@echo off
setlocal
cd /d "%~dp0\.."

set "PY_CMD="
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 set "PY_CMD=python"
if not defined PY_CMD (
    where py >nul 2>&1
    if %ERRORLEVEL% EQU 0 set "PY_CMD=py"
)

if not defined PY_CMD goto no_python

echo ======================================================================
echo                  OTC-OW IMAGE TOOLS LAUNCHER
echo ======================================================================
echo Launching Image and History Management Console...
echo.

if "%1"=="" (
    %PY_CMD% scripts\backend\image_tools_backend.py
) else if "%1"=="audit" (
    %PY_CMD% scripts\backend\image_tools_backend.py --audit
) else if "%1"=="optimize" (
    %PY_CMD% scripts\backend\image_tools_backend.py --optimize
) else if "%1"=="prune" (
    %PY_CMD% scripts\backend\image_tools_backend.py --prune %2
) else if "%1"=="guide" (
    %PY_CMD% scripts\backend\image_tools_backend.py --guide
) else (
    %PY_CMD% scripts\backend\image_tools_backend.py %*
)
goto :eof

:no_python
echo ======================================================================
echo                        PYTHON NOT DETECTED
echo ======================================================================
echo Python 3 is required to run the image optimization engine.
echo.
echo Please install Python 3 from https://www.python.org/downloads/
echo (Check "Add Python to PATH" during installation)
echo.
pause
goto :eof
