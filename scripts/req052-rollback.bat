@echo off
REM REQ-052 回退：联系人角色从键（developer / maincon …）改回旧标签（「客户 Client」等）（退回旧版本代码前用）。
REM 先 pm2 stop audax 再跑。会先把 data\audax.db 备份到 data\backups\pre-req052-rollback-<时间>.db。
REM 只看会改哪些、不写库：scripts\req052-rollback.bat --dry-run
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req052-rollback.ts %*
pause
