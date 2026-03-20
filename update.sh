#!/bin/bash
# Universal Trading Remote - 一鍵更新腳本
# 從 GitHub 拉取最新版本並重新建置

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔄 正在從 GitHub 拉取最新版本..."
git pull origin main

echo "📦 正在安裝依賴..."
npm install

echo "🔨 正在建置..."
npm run build

echo ""
echo "✅ 更新完成！"
echo "👉 請到 chrome://extensions 點擊插件的「重新載入」按鈕"