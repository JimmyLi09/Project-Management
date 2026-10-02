@echo off
REM AV-019 回退：把用到规则包 led@1.1 的立项记录 / LED 方案版本改回 led@1.0（退回旧版本代码前用）。
REM 先 pm2 stop audax 再跑。会先把 data\audax.db 备份到 data\backups\pre-av019-rollback-<时间>.db。
REM 只看会改哪些、不写库：scripts\av019-rollback.bat --dry-run
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\av019-rollback.ts %*
pause
