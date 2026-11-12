@echo off
REM REQ-063 回退：删 app_settings 的修改记录上线日（req063Since）；修改记录写进报告 + JSON（退代码前用）。
REM 项目里的修改记录字段默认留着（旧代码不读）；加 --strip 才去掉。KPI 规则版本不动。不带参数只报告；加 --apply 才写库。
REM 先 pm2 stop audax 再跑。写库前会先把 data\audax.db 备份到 data\backups\pre-req063-rollback-^<时间^>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req063-rollback.ts %*
pause
