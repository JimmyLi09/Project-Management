@echo off
REM Audax 项目协作台 — 一键更新 (Windows)
REM 用法: 双击此文件,或在项目目录命令行执行 scripts\update.bat
REM       要一并装「文字识别 OCR」(可选,AV-015 识别服务的第二道兜底): scripts\update.bat --with-ocr
setlocal

REM 1001: 先把自己复制到 %TEMP% 再从那里跑。cmd 是边读边执行 .bat 的, 而下面的
REM git reset 会把这个文件换成新版本 —— 新旧内容长度不同时, cmd 会从错位的地方接着读,
REM 执行半截命令(上次「× 更新失败」很可能就是这个)。复制出去的那一份不会被改。
if /i not "%~1"=="--copied" (
  set "AUDAX_ROOT=%~dp0.."
  copy /y "%~f0" "%TEMP%\audax-update-run.bat" >nul 2>nul && (
    call "%TEMP%\audax-update-run.bat" --copied %*
    exit /b
  )
)
if /i "%~1"=="--copied" shift
if not defined AUDAX_ROOT set "AUDAX_ROOT=%~dp0.."
cd /d "%AUDAX_ROOT%"
if /i "%~1"=="--with-ocr" set "WITH_OCR=1"
REM 时间戳: 快照和构建日志共用。用 PowerShell 取: 新版 Windows 已移除 wmic。
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%I"

echo ==^> 更新前快照 Snapshotting the database first...
REM 更新前先给数据库留一份带时间戳的快照,和每日自动备份分开存,
REM 万一新版本有问题,可以直接用这一份回到更新前那一刻。
if not exist "data\audax.db" (
  echo ^(未发现 data\audax.db,首次部署,跳过快照^)
) else (
  if not exist "data\backups" mkdir "data\backups"
  set "SNAP=data\backups\pre-update-%TS%.db"
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
call npm install || goto :installFailed

REM 1001: 先构建到 .next-build, 成功了才换成 .next。构建失败时正在用的 .next 原封不动,
REM 照样重启 —— 保证旧版本或新版本至少一个能跑。构建输出存到 data\logs\build-<时间>.log。
if not exist "data\logs" mkdir "data\logs"
set "BLOG=data\logs\build-%TS%.log"
echo ==^> 构建 Building... ^(约 1-3 分钟, 输出写在 %BLOG%^)
if exist ".next-build" rmdir /s /q ".next-build"
set "NEXT_DIST_DIR=.next-build"
call npm run build > "%BLOG%" 2>&1
set "BUILD_RC=%errorlevel%"
set "NEXT_DIST_DIR="
if not "%BUILD_RC%"=="0" goto :buildFailed
echo √ 构建完成

echo ==^> 换上新版本并重启 Switching to the new build and restarting...
where pm2 >nul 2>nul && call pm2 stop audax >nul 2>nul
if exist ".next-prev" rmdir /s /q ".next-prev"
if exist ".next" (
  move ".next" ".next-prev" >nul || goto :swapFailed
)
move ".next-build" ".next" >nul || (
  move ".next-prev" ".next" >nul
  goto :swapFailed
)
call :restart

echo ==^> 制图服务 Python ^(AV 平台: 图纸解析 / DXF / 技术方案书 / 历史案例^)...
REM 虚拟环境在 services\drawing\.venv(已 .gitignore,更新不会动它)。没装 Python 时
REM 只提示,不中断: AV 以外的功能不受影响。
REM 英文版 Windows 的系统编码是 cp1252,pip 会按它读 requirements.txt,里面只要有
REM 一个非 ASCII 字节就报 UnicodeDecodeError 整个装不上。那份文件的注释已改成英文,
REM 这里再设一道 PYTHONUTF8=1 兜底 —— 以后谁往里写了中文也不会炸。
set "PYTHONUTF8=1"
set "PYV=services\drawing\.venv"
if not exist "%PYV%\Scripts\python.exe" (
  where py >nul 2>nul && py -3 -m venv "%PYV%"
)
if not exist "%PYV%\Scripts\python.exe" (
  where python >nul 2>nul && python -m venv "%PYV%"
)
if exist "%PYV%\Scripts\python.exe" (
  "%PYV%\Scripts\python.exe" -m pip install -q -r services\drawing\requirements.txt && echo √ 制图服务依赖已就绪 || echo ! 制图服务依赖安装失败, 需能上外网. AV 的图纸解析 / DXF / 方案书 / 案例导入暂不可用
) else (
  echo ! 未找到 Python, 建议 3.11. AV 的图纸解析 / DXF / 方案书 / 案例导入需要它, 装好后重新运行本脚本
)

REM AV-015: 文字识别 OCR 是可选的第二道兜底(本机视觉模型不可用时用它读图上的数字)。
REM paddleocr 2.9.1 要 numpy^<2,和制图服务的 numpy 2.x 冲突,所以放独立的 .venv-ocr,
REM 两边互不影响。体积约 1.6 GB,首次识别时还会下载模型权重,默认不装。
if "%WITH_OCR%"=="1" (
  echo ==^> 文字识别 OCR ^(可选, 独立虚拟环境 services\drawing\.venv-ocr^)...
  if not exist "services\drawing\.venv-ocr\Scripts\python.exe" (
    where py >nul 2>nul && py -3.11 -m venv "services\drawing\.venv-ocr"
  )
  if not exist "services\drawing\.venv-ocr\Scripts\python.exe" (
    where python >nul 2>nul && python -m venv "services\drawing\.venv-ocr"
  )
  if exist "services\drawing\.venv-ocr\Scripts\python.exe" (
    "services\drawing\.venv-ocr\Scripts\python.exe" -m pip install -q -r services\drawing\requirements-ocr.txt && echo √ 文字识别已就绪 || echo ! 文字识别安装失败, 不影响其它功能: 图片识别仍可用本机视觉模型或手填
    REM 第一次运行要下载识别权重, 在这里先跑一张, 免得同事第一次用时等很久
    pushd services\drawing
    ".venv-ocr\Scripts\python.exe" -m avdrawing.ingest.ocrcli tests\fixtures\vision\arc_photo_0930.jpg >nul 2>nul && echo √ 文字识别权重已下载 || echo ! 文字识别权重暂未下载成功, 首次使用时会再试
    popd
  ) else (
    echo ! 未找到 Python, 跳过文字识别
  )
)

REM AV-015: 更新完查一次识别服务(本机 Ollama)在不在、模型装没装、GPU 还是 CPU。
REM 只打印,不影响更新结果;没装时同事上传图片会自动改为手填。
call node scripts\vision-check.mjs
echo √ 更新完成 Update done.
pause
exit /b 0

:err
echo × 更新失败,请把上面的报错发给管理员。^(服务没有动过, 还是更新前的版本^)
pause
exit /b 1

:installFailed
echo × 安装依赖失败。照样重启服务, 尽量让网站继续能用。
call :restart
echo × 更新失败,请把上面 npm install 的报错发给管理员。
pause
exit /b 1

:buildFailed
echo × 构建失败: 新版本没换上, 继续用更新前构建好的版本, 并照样重启。
call :restart
echo   构建日志最后 30 行 ^(完整日志: %BLOG%^):
powershell -NoProfile -Command "Get-Content -Tail 30 -Encoding UTF8 '%BLOG%'"
echo × 更新失败,请把 %BLOG% 发给管理员。
pause
exit /b 1

:swapFailed
echo × 新版本已构建好, 但换不上 ^(.next 文件夹被占用? 没用 pm2 的话先关掉 npm start 窗口^)。
echo   继续用旧版本并重启; 关掉占用后重新运行本脚本即可。
call :restart
pause
exit /b 1

:restart
echo ==^> 重启服务 Restarting...
where pm2 >nul 2>nul
if %errorlevel%==0 (
  call pm2 restart audax 2>nul || call pm2 start npm --name audax -- start
  call pm2 save
  echo √ 已通过 pm2 重启 ^(进程名 audax^)
) else (
  echo ! 未安装 pm2。请手动重启: 关闭旧的 npm start 窗口,重新执行 npm start
)
exit /b 0
