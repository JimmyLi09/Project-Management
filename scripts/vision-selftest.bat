@echo off
REM AV-015 识别服务实测：用 0930 弧形屏照片（或你指定的图片）跑一次本机视觉模型，
REM 记录写到 data\vision-selftest-<时间>.md，发回即可。只读，不改数据库。
REM 用法：双击；或 scripts\vision-selftest.bat D:\某张图.jpg
cd /d "%~dp0.."
REM .ts 由 scripts\ts-loader.mjs 现场转译:服务器上的 Node 20 LTS 直接能跑,不用另装东西
node --no-warnings --import ./scripts/ts-register.mjs scripts\vision-selftest.ts %*
pause
