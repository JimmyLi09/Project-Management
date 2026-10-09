@echo off
REM REQ-048 回退：把上线迁移改过的排期还原（退回旧版本代码前用）。不带参数只报告；加 --apply 才写库。
REM 先 pm2 stop audax 再跑。写库前会先把 data\audax.db 备份到 data\backups\pre-req048-rollback-^<时间^>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req048-rollback.ts %*
pause
