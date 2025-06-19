#!/bin/bash

echo "🛑 Stopping Tryp Transit v0.2 Application"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to kill processes by port
kill_process_on_port() {
    local port=$1
    local process_name=$2
    
    echo "Looking for $process_name on port $port..."
    
    # Find PID of process using the port
    local pid=$(lsof -ti:$port 2>/dev/null)
    
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}Found process $pid on port $port, killing...${NC}"
        kill -TERM $pid 2>/dev/null
        
        # Wait a moment and force kill if still running
        sleep 2
        if kill -0 $pid 2>/dev/null; then
            echo "Force killing process $pid..."
            kill -KILL $pid 2>/dev/null
        fi
        
        echo -e "${GREEN}✅ Stopped $process_name${NC}"
    else
        echo "No process found on port $port"
    fi
}

# Kill processes on known ports
kill_process_on_port 3000 "Frontend (Next.js)"
kill_process_on_port 5001 "Backend (Flask)"

# Also try to kill any remaining node or python processes related to the app
echo "Cleaning up any remaining processes..."

# Kill any node processes in the src directory
pkill -f "next dev" 2>/dev/null
pkill -f "npm run dev" 2>/dev/null

# Kill any python processes running app.py
pkill -f "python.*app.py" 2>/dev/null

echo -e "${GREEN}✅ All services stopped${NC}"
echo ""
echo "To restart the application, run:"
echo "  ./start-app.sh" 