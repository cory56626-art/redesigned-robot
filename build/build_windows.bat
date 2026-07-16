@echo off
rem ---------------------------------------------------------------
rem Builds Backseat.exe. Just double-click this file on Windows.
rem Requires: Python 3.11 installed with "Add python.exe to PATH".
rem Output:   dist\Backseat\Backseat.exe (the whole folder is the app)
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0\.."

where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python was not found on PATH.
    echo Install Python 3.11 from python.org and tick "Add python.exe to PATH".
    pause
    exit /b 1
)

echo [1/4] Creating a clean build environment (.venv-build)...
python -m venv .venv-build
if errorlevel 1 ( echo ERROR: could not create the venv. & pause & exit /b 1 )
call .venv-build\Scripts\activate.bat

echo [2/4] Installing Backseat and its dependencies...
python -m pip install --upgrade pip --quiet
python -m pip install ".[google]" pyinstaller --quiet
if errorlevel 1 ( echo ERROR: pip install failed. Check your internet connection. & pause & exit /b 1 )

echo [3/4] Building the exe (this takes a minute or two)...
pyinstaller build\backseat.spec --noconfirm --distpath dist --workpath build\pyi-work
if errorlevel 1 ( echo ERROR: PyInstaller failed. Scroll up for details. & pause & exit /b 1 )

echo [4/4] Done!
echo.
echo   Your app: dist\Backseat\Backseat.exe
echo   (Keep the whole dist\Backseat folder together - the exe needs
echo    the files next to it. A Start Menu installer comes later.)
echo.
pause
