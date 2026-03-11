@echo off
setlocal
cd /d %~dp0

echo ===========================================
echo    SUBIENDO CAMBIOS A GITHUB - ROCKET HAX
echo ===========================================

git add .
git commit -m "Ajuste de fisica: sin prediccion y mas lento"
git push origin main --force

echo.
echo ===========================================
echo    TODO LISTO CHE! PROYECTO ACTUALIZADO
echo ===========================================
pause