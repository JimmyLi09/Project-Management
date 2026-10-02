@echo off
REM REQ-044 回退：把项目上的共用信息清单拆回各服务包（退回旧版本代码前用）。
REM 先 pm2 stop audax 再跑。会先把 data\audax.db 备份到 data\backups\pre-req044-rollback-<时间>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req044-rollback.ts %*
pause
