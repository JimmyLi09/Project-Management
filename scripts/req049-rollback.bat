@echo off
REM REQ-049 回退：退回旧版本代码不需要跑这个。不带参数 = 只报告并把 Job Record 4 栏表导出成 CSV（data\migrations\）；加 --apply 才删掉 4 栏表（先备份）。
REM 先 pm2 stop audax 再跑。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req049-rollback.ts %*
pause
