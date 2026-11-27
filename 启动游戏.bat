@echo off
chcp 65001 >nul
setlocal
set "GAME=%~dp0start.py"
set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python315\python.exe"
if exist "%PYTHON%" (
  "%PYTHON%" "%GAME%"
  goto done
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%GAME%"
  goto done
)
where python >nul 2>nul
if not errorlevel 1 (
  python "%GAME%"
  goto done
)
echo Python 3 was not found. Install Python 3 and run this launcher again.
:done
pause
endlocal
