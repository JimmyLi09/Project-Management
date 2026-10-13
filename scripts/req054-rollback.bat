@echo off
REM REQ-054 回退：上线迁移去掉的编号放回去（先 pm2 stop audax）。不带参数只报告；--apply 才改，改之前先备份到 data\backups\。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req054-rollback.ts %*
pause
