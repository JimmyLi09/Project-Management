@echo off
REM REQ-061 回退：知识库改版新加的表（kb_previews、kb_map_versions）删掉，新列（biz、sec、uploaded_by）清空（退代码前用）。
REM 文档正文、版本历史、附件原文件都不动。不带参数只报告；加 --apply 才写库。
REM 先 pm2 stop audax 再跑。写库前会先把 data\audax.db 备份到 data\backups\pre-req061-rollback-^<时间^>.db。
cd /d "%~dp0.."
node --no-warnings --import ./scripts/ts-register.mjs scripts\req061-rollback.ts %*
pause
