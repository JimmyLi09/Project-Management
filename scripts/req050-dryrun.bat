@echo off
REM REQ-050 信息清单不重复 · 迁移预演。只读：复制一份 data\audax.db 到 data\migrations\ 再在副本上合并「(#2)」重复项，
REM 报告写到 data\migrations\050-checklist-dryrun-<时间>.md。正式数据库不改，网站开着也能跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req050-dryrun.ts %*
pause
