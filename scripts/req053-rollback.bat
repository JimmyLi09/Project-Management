@echo off
REM REQ-053 回退：把 Job Record 硬件的 4 栏行放回去（退回 REQ-049 那一版代码前用）。不带参数只报告；加 --apply 才写库。
REM 先 pm2 stop audax 再跑。写库前会先把 data\audax.db 备份到 data\backups\pre-req053-rollback-^<时间^>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req053-rollback.ts %*
pause
