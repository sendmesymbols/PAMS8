@echo off
REM PAMS8 "project node" runner: runs any npm command using ONLY this project's
REM embedded Node. The PATH edit is process-local (setlocal), so it never leaks
REM into your shell, fnm, or the shared D:\Projects\GenAI\PredictionEngine\node24.
REM Usage:  pn.cmd run build   |   pn.cmd install   |   pn.cmd run dev
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%node\node.exe" (
  echo [PAMS8] Embedded Node missing. Run setup first:
  echo         powershell -ExecutionPolicy Bypass -File "%ROOT%setup.ps1"
  exit /b 1
)
set "PATH=%ROOT%node;%ROOT%node_modules\.bin;%PATH%"
call "%ROOT%node\npm.cmd" %*
set "EC=%ERRORLEVEL%"
endlocal & exit /b %EC%
