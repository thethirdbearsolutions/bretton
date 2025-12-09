#!/bin/bash
# stop-and-restart.sh - Automated script to stop old server and start new one

echo "🛑 BRETTON WOODS SERVER - STOP & RESTART SCRIPT"
echo "================================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Stop the old server
echo "📍 STEP 1: Stopping old server..."
echo ""

# Try to find process on port 65002
PID=$(lsof -t -i:65002 2>/dev/null)

if [ ! -z "$PID" ]; then
    echo "Found process on port 65002 (PID: $PID)"
    echo "Attempting to stop..."
    kill -9 $PID 2>/dev/null
    sleep 2
    
    # Check if it's really stopped
    NEW_PID=$(lsof -t -i:65002 2>/dev/null)
    if [ -z "$NEW_PID" ]; then
        echo -e "${GREEN}✅ Successfully stopped process $PID${NC}"
    else
        echo -e "${YELLOW}⚠️  Process still running, trying harder...${NC}"
        sudo kill -9 $PID 2>/dev/null
    fi
else
    echo "No process found on port 65002"
fi

# Kill any remaining node processes
echo ""
echo "Cleaning up any remaining node processes..."
killall -9 node 2>/dev/null
sleep 1

echo ""
echo "📍 STEP 2: Verifying server is stopped..."
echo ""

# Check if anything is still running
REMAINING=$(ps aux | grep node | grep -v grep | grep -v stop-and-restart)
if [ -z "$REMAINING" ]; then
    echo -e "${GREEN}✅ All clear! No node processes running.${NC}"
else
    echo -e "${YELLOW}⚠️  Some processes still detected:${NC}"
    echo "$REMAINING"
    echo ""
    echo "Attempting force kill with sudo..."
    sudo killall -9 node 2>/dev/null
    sleep 1
fi

echo ""
echo "📍 STEP 3: Testing new game data..."
echo ""

# Test if we have the new game data
if [ -f "test-countries.js" ]; then
    node test-countries.js
    
    # Check if test passed
    if node test-countries.js | grep -q "SUCCESS! All 7 countries present"; then
        echo ""
        echo -e "${GREEN}✅ Game data verified - 7 countries ready!${NC}"
    else
        echo ""
        echo -e "${RED}❌ WARNING: Game data may not have India & Argentina!${NC}"
        echo "You may need to download the new files."
    fi
else
    echo -e "${YELLOW}⚠️  test-countries.js not found${NC}"
    echo "Cannot verify game data. Make sure you have the latest files."
fi

echo ""
echo "📍 STEP 4: Installing dependencies..."
echo ""

# Install npm packages if needed
if [ -f "package.json" ]; then
    npm install
else
    echo -e "${RED}❌ ERROR: package.json not found!${NC}"
    echo "Make sure you're in the correct directory."
    exit 1
fi

echo ""
echo "📍 STEP 5: Starting server..."
echo ""

# Check one more time that port is free
FINAL_CHECK=$(lsof -t -i:65002 2>/dev/null)
if [ ! -z "$FINAL_CHECK" ]; then
    echo -e "${RED}❌ ERROR: Port 65002 is still in use!${NC}"
    echo "Run this command manually: sudo kill -9 $FINAL_CHECK"
    exit 1
fi

# Start the server
echo "Starting Bretton Woods server..."
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Server starting on port 65002             ║${NC}"
echo -e "${GREEN}║                                            ║${NC}"
echo -e "${GREEN}║  Access at: http://your-server-ip:65002    ║${NC}"
echo -e "${GREEN}║                                            ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop server               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

npm start
