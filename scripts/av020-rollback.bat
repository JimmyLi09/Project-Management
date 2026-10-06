@echo off
REM AV-020 回退：把用到规则包 prj@0.2 的投影项目改回 prj@0.1-draft（退回旧版本代码前用）。
REM 先 pm2 stop audax 再跑。会先把 data\audax.db 备份到 data\backups\pre-av020-rollback-<时间>.db。
REM 只看会改哪些、不写库：scripts\av020-rollback.bat --dry-run
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\av020-rollback.ts %*
pause
