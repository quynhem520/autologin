@echo off
color 0A
echo ===== CAI DAT CAC GOI PHU THUOC =====
echo.

:: Kiem tra Node.js da duoc cai dat chua
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo Loi: Node.js chua duoc cai dat!
    echo Vui long cai dat Node.js tu https://nodejs.org/
    echo.
    pause
    exit /b
)

echo Dang cai dat cac goi phu thuoc...
npm install puppeteer-extra puppeteer-extra-plugin-stealth chalk axios exceljs p-limit

echo.
echo Cai dat hoan tat!
echo.
pause