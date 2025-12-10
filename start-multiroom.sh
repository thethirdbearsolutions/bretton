#!/bin/bash
# start-multiroom.sh - Start Bretton Woods Multi-Room Server

echo "🌍 Bretton Woods Multi-Room Server"
echo "==================================="
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

echo "🚀 Starting multi-room server..."
echo ""
echo "📍 Server will be available at:"
echo "   http://localhost:65002"
echo ""
echo "✨ Features:"
echo "   - Multiple game rooms"
echo "   - Room lobby"
echo "   - Independent games"
echo "   - Room management"
echo ""
echo "Press Ctrl+C to stop the server"
echo "==================================="
echo ""

node server-multiroom.js
