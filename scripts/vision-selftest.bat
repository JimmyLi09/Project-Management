@echo off
REM AV-015 识别服务实测：用 0930 弧形屏照片（或你指定的图片）跑一次本机视觉模型，
REM 记录写到 data\vision-selftest-<时间>.md，发回即可。只读，不改数据库。
REM 用法：双击；或 scripts\vision-selftest.bat D:\某张图.jpg
cd /d "%~dp0.."
node --experimental-strip-types --no-warnings scripts\vision-selftest.ts %*
pause
