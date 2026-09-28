@echo off
REM Audax 项目协作台 — 一键更新 (Windows)
REM 用法: 双击此文件,或在项目目录命令行执行 scripts\update.bat
cd /d "%~dp0.."

echo ==^> 更新前快照 Snapshotting the database first...
REM 更新前先给数据库留一份带时间戳的快照,和每日自动备份分开存,
REM 万一新版本有问题,可以直接用这一份回到更新前那一刻。
if not exist "data\audax.db" (
  echo ^(未发现 data\audax.db,首次部署,跳过快照^)
) else (
  if not exist "data\backups" mkdir "data\backups"
  REM 用 PowerShell 取时间戳:新版 Windows 已移除 wmic,这样更稳。
  for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "SNAP=data\backups\pre-update-%%I.db"
  call :snapshot
)
goto :afterSnapshot

:snapshot
copy /y "data\audax.db" "%SNAP%" >nul || goto :err
if exist "data\audax.db-wal" copy /y "data\audax.db-wal" "%SNAP%-wal" >nul
if exist "data\audax.db-shm" copy /y "data\audax.db-shm" "%SNAP%-shm" >nul
echo √ 已快照到 %SNAP%
exit /b 0

:afterSnapshot

echo ==^> 拉取最新代码 Pulling latest code (branch: main)...
REM data\ 在 .gitignore 里,git 操作不会动它 —— 数据库安全。
git fetch origin main || goto :err
git checkout main 2>nul || git checkout -b main origin/main
git reset --hard origin/main || goto :err

echo ==^> 安装依赖 Installing dependencies...
call npm install || goto :err

echo ==^> 构建 Building...
call npm run build || goto :err

echo ==^> 重启服务 Restarting...
where pm2 >nul 2>nul
if %errorlevel%==0 (
  call pm2 restart audax 2>nul || call pm2 start npm --name audax -- start
  call pm2 save
  echo √ 已通过 pm2 重启 ^(进程名 audax^)
) else (
  echo ! 未安装 pm2。请手动重启: 关闭旧的 npm start 窗口,重新执行 npm start
)
echo √ 更新完成 Update done.
pause
exit /b 0

:err
echo × 更新失败,请把上面的报错发给管理员。
pause
exit /b 1
