@echo off
REM 删除已合并进 main 的远端分支（GitHub 上的）。在服务器的项目目录或本仓库的任何一份 git clone 里运行。
REM 不带参数：只列出来，不删。--apply：删「已合并」的（要输入 YES 确认）。--apply --with-content-merged：连「内容已在 main」的一起删。
REM --keep a,b：这几个不删。main / master 永远不删。删了什么写到 data\migrations\branches-deleted-^<时间^>.md。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\delete-merged-branches.ts %*
pause
