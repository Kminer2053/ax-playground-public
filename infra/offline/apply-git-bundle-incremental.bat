@echo off
setlocal EnableExtensions
REM GitHub 증분 bundle -> Gitea + 로컬 main 반영 (내부망 Windows)
REM
REM 더블클릭 또는:
REM   apply-git-bundle-incremental.bat
REM   apply-git-bundle-incremental.bat D:\path\ax-playground-update.bundle
REM   apply-git-bundle-incremental.bat /HARD   (merge 대신 reset --hard)
REM
REM 기본 경로 (내부망 ax-playground clone) - 환경에 맞게 수정:
REM   REPO   = 내부망 clone 위치
REM   BUNDLE = 망간자료전송 반입 폴더의 bundle 경로 (인자로도 지정 가능)

set "REPO=C:\projects\ax-playground"
set "BUNDLE=%USERPROFILE%\Downloads\ax-playground-update.bundle"
set "MODE=merge"

:parseArgs
if "%~1"=="" goto argsDone
if /I "%~1"=="/HARD" (set "MODE=hard" & shift & goto parseArgs)
if /I "%~1"=="--hard" (set "MODE=hard" & shift & goto parseArgs)
set "BUNDLE=%~1"
shift
goto parseArgs

:argsDone
echo.
echo === AX Playground: apply git bundle (incremental) ===
echo REPO  : %REPO%
echo BUNDLE: %BUNDLE%
echo MODE  : %MODE%
echo.

if not exist "%REPO%\.git" (
  echo [ERROR] Not a git repo: %REPO%
  goto fail
)
if not exist "%BUNDLE%" (
  echo [ERROR] Bundle not found: %BUNDLE%
  echo         Copy ax-playground-update.bundle to SecureGate Download first.
  goto fail
)

cd /d "%REPO%"
if errorlevel 1 goto fail

echo [1/6] verify bundle...
git bundle verify "%BUNDLE%"
if errorlevel 1 goto fail

echo.
echo [2/6] list heads...
git bundle list-heads "%BUNDLE%"
if errorlevel 1 goto fail

echo.
echo [3/6] fetch bundle -> github-main...
git fetch "%BUNDLE%" refs/remotes/origin/main:refs/heads/github-main
if errorlevel 1 goto fail

echo.
echo [4/6] checkout main...
git checkout main
if errorlevel 1 goto fail

if /I "%MODE%"=="hard" (
  echo [5/6] reset --hard github-main...
  git reset --hard github-main
) else (
  echo [5/6] merge github-main...
  git merge github-main --no-edit
)
if errorlevel 1 goto fail

echo.
echo [6/6] push origin main...
git push origin main
if errorlevel 1 (
  echo [WARN] push rejected. If history diverged, re-run with /HARD after backup branch.
  goto fail
)

for /f %%H in ('git rev-parse HEAD') do set "NEWHEAD=%%H"
echo %NEWHEAD%> "%REPO%\infra\offline\git-bundle-base.txt"

echo.
echo === OK ===
git log -1 --oneline
echo HEAD: %NEWHEAD%
echo BASE file updated: %REPO%\infra\offline\git-bundle-base.txt
echo.
echo Optional: copy git-bundle-base.txt to external repo for next incremental bundle.
echo Then: npm run build ^& restart app
echo.
pause
exit /b 0

:fail
echo.
echo === FAILED ===
pause
exit /b 1
