#!/bin/bash

echo "🚀 Starting Tryp Transit v0.2 Application"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js first.${NC}"
    exit 1
fi

if ! command_exists python3; then
    echo -e "${RED}❌ Python 3 is not installed. Please install Python 3 first.${NC}"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm is not installed. Please install npm first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites found${NC}"

# Check if we're in the right directory
if [ ! -f "src/package.json" ] || [ ! -f "model_service/app.py" ]; then
    echo -e "${RED}❌ Please run this script from the project root directory${NC}"
    exit 1
fi

# Function to handle cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down services...${NC}"
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    echo -e "${GREEN}✅ Services stopped${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Check environment variables
echo -e "\n${BLUE}📋 Environment Setup${NC}"
if [ ! -f "src/.env.local" ]; then
    echo -e "${YELLOW}⚠️  Frontend environment file not found. Creating from template...${NC}"
    if [ -f "src/.env.example" ]; then
        cp src/.env.example src/.env.local
        echo -e "${YELLOW}✅ Created src/.env.local from template${NC}"
        echo -e "${YELLOW}📝 Please edit src/.env.local and add your API keys:${NC}"
        echo -e "${YELLOW}   - OPENAI_API_KEY: Get from https://platform.openai.com/api-keys${NC}"
        echo -e "${YELLOW}   - NEXT_PUBLIC_TOMTOM_API_KEY: Get from https://developer.tomtom.com/${NC}"
    else
        echo -e "${RED}❌ src/.env.example not found. Please create environment configuration.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Frontend environment file found${NC}"
fi

# Setup frontend
echo -e "\n${BLUE}📦 Setting up frontend...${NC}"
cd src

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to install frontend dependencies${NC}"
        exit 1
    fi
else
    echo "Frontend dependencies already installed"
fi

# Start frontend in background
echo -e "${GREEN}🚀 Starting frontend on http://localhost:3000${NC}"
npm run dev &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

# Setup backend
echo -e "\n${BLUE}🐍 Setting up backend...${NC}"
cd ../model_service

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to create virtual environment${NC}"
        exit 1
    fi
    
    # Activate virtual environment and install dependencies
    echo "Installing Python dependencies..."
    source venv/bin/activate
    python -m pip install --upgrade pip setuptools wheel
    python -m pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to install Python dependencies${NC}"
        exit 1
    fi
else
    echo "Virtual environment already exists"
fi

# Start backend in background
echo -e "${GREEN}🚀 Starting backend on http://localhost:5001${NC}"
source venv/bin/activate
python app.py &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 5

# Check if services are running
echo -e "\n${BLUE}🔍 Checking service status...${NC}"

if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend is running on http://localhost:3000${NC}"
else
    echo -e "${RED}❌ Frontend failed to start${NC}"
    cleanup
fi

if curl -s http://localhost:5001 >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running on http://localhost:5001${NC}"
else
    echo -e "${YELLOW}⚠️  Backend may still be starting up...${NC}"
fi

echo -e "\n${GREEN}🎉 Application is starting up!${NC}"
echo -e "${BLUE}📱 Frontend: http://localhost:3000${NC}"
echo -e "${BLUE}🔧 Backend: http://localhost:5001${NC}"
echo -e "${BLUE}🧪 Test page: http://localhost:3000/test${NC}"
echo -e "\n${YELLOW}📝 Note: Models are using mock predictions (chronos-forecasting not available)${NC}"
echo -e "${YELLOW}📝 For API keys, edit src/.env.local with your OpenAI and TomTom keys${NC}"
echo -e "\n${YELLOW}Press Ctrl+C to stop all services${NC}"

# Keep script running
wait 