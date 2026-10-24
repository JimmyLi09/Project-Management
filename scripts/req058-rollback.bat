@echo off
REM REQ-058 回退：模板管理里的覆盖值、同义项换回迁移前那份（退代码前用）。不带参数只报告；加 --apply 才写库。
REM 先 pm2 stop audax 再跑。写库前会先把 data\audax.db 备份到 data\backups\pre-req058-rollback-^<时间^>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req058-rollback.ts %*
pause
