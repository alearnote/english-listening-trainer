@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First launch: installing required packages...
  call npm install
)
echo.
echo Starting English Listening Trainer...
start "" http://localhost:3000
npm start
pause
