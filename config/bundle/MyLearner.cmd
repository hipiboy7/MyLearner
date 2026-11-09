@echo off
rem MyLearner - 로컬 서버를 켜고 브라우저로 엽니다(서버 모드). 끄려면 이 창에서 Ctrl+C. 문서: README_KO.txt
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 -m mylearner serve %*) else (python -m mylearner serve %*)
pause
