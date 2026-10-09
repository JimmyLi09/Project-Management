@echo off
REM REQ-051 回退：不带参数只报告（权限表改了哪几格、删过哪些账号）；--reset-perms 权限表恢复默认；--undelete ^<账号^> 撤销误删。
REM 退回旧版本代码不需要跑这个。写库前会先把 data\audax.db 备份到 data\backups\pre-req051-rollback-^<时间^>.db。先 pm2 stop audax 再跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req051-rollback.ts %*
pause
