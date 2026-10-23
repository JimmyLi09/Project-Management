@echo off
REM REQ-058 信息清单模板 · 迁移预演。只读：看「模板管理」里存过哪些业务模板、同义项有没有单独存过，
REM 按上线规则算一遍（只换清单部分、排期保留），报告写到 data\migrations\058-templates-dryrun-<时间>.md。正式数据库不改。
REM JM 看过报告后加 --approve 再跑一次：在正式库记一笔「已确认」，之后正式迁移（新版本启动时）才会跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req058-dryrun.ts %*
pause
