@echo off
REM Audax 项目协作台 — 一键更新 (Windows)
REM 用法: 双击此文件,或在项目目录命令行执行 scripts\update.bat
cd /d "%~dp0.."

echo ==^> 拉取最新代码 Pulling latest code...
git pull || goto :err

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
