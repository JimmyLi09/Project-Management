@echo off
REM REQ-062 回退：新人培训改版新加的表删掉，users 的 pm_level / mentor / novice_start 清空，派项目限制关掉（退代码前用）。
REM REQ-036 的老培训路径、进度、成绩都不动。不带参数只报告；加 --apply 才写库。
REM 先 pm2 stop audax 再跑。写库前会先把 data\audax.db 备份到 data\backups\pre-req062-rollback-^<时间^>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req062-rollback.ts %*
pause
