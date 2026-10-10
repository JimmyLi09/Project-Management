@echo off
REM REQ-050 回退：退回旧版本代码前，把信息清单分了格的项拆回单独几条（旧版本只认那种）。
REM 不带参数 = 只报告会改什么；加 --apply 才写库（先自动备份到 data\backups\）。先 pm2 stop audax 再跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req050-rollback.ts %*
pause
