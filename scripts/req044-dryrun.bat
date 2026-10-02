@echo off
REM REQ-044 共用信息清单 · 迁移预演。只读：复制一份 data\audax.db 到 data\migrations\ 再在副本上合并，
REM 报告写到 data\migrations\044-checklist-merge-dryrun-<时间>.md。正式数据库不改，网站开着也能跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req044-dryrun.ts %*
pause
