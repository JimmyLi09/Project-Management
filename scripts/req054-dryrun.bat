@echo off
REM REQ-054 售前接洽 · 迁移预演。只读：复制一份 data\audax.db 到 data\migrations\ 再在副本上把 049 去掉编号、改为售前记录，
REM 报告写到 data\migrations\054-approach-dryrun-<时间>.md。正式数据库不改，网站开着也能跑。
REM JM 看过报告后加 --approve 再跑一次（要一起改 046 就加 --include 046）：重新预演并在正式库记一笔「已确认」，之后正式迁移（新版本启动时）才会跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req054-dryrun.ts %*
pause
