@echo off
REM REQ-053 Job Record 硬件回到登记表 · 迁移预演。只读：复制一份 data\audax.db 到 data\migrations\ 再在副本上删拆分行，
REM 报告写到 data\migrations\053-jobrecord-dryrun-<时间>.md。正式数据库不改，网站开着也能跑。
REM JM 看过报告后加 --approve 再跑一次：重新预演并在正式库记一笔「已确认」，之后正式迁移（新版本启动时）才会跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req053-dryrun.ts %*
pause
