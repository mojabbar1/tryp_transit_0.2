#!/bin/bash

echo "🧪 Testing Tryp Transit v0.2 Setup"
echo "=================================="

# Test 1: Check if src directory exists and has package.json
echo "1. Checking frontend structure..."
if [ -f "src/package.json" ]; then
    echo "✅ src/package.json found"
else
    echo "❌ src/package.json not found"
    exit 1
fi

# Test 2: Check if model_service directory exists and has app.py
echo "2. Checking model service structure..."
if [ -f "model_service/app.py" ]; then
    echo "✅ model_service/app.py found"
else
    echo "❌ model_service/app.py not found"
    exit 1
fi

# Test 3: Check if README.md exists
echo "3. Checking documentation..."
if [ -f "README.md" ]; then
    echo "✅ README.md found"
else
    echo "❌ README.md not found"
    exit 1
fi

# Test 4: Check if .gitignore exists
echo "4. Checking git configuration..."
if [ -f ".gitignore" ]; then
    echo "✅ .gitignore found"
else
    echo "❌ .gitignore not found"
    exit 1
fi

# Test 5: Check if LICENSE exists
echo "5. Checking license..."
if [ -f "LICENSE" ]; then
    echo "✅ LICENSE found"
else
    echo "❌ LICENSE not found"
    exit 1
fi

echo ""
echo "🎉 All structure tests passed!"
echo ""
echo "📋 Quick Start Options:"
echo ""
echo "Option 1 - Use the automated startup script:"
echo "  chmod +x start-app.sh && ./start-app.sh"
echo ""
echo "Option 2 - Manual setup:"
echo "  1. cd src && npm install"
echo "  2. cd ../model_service && python3 -m venv venv"
echo "  3. source venv/bin/activate && pip install -r requirements.txt"
echo "  4. Start model service: python app.py (runs on port 5001)"
echo "  5. Start frontend: cd ../src && npm run dev (runs on port 3000)"
echo ""
echo "🌐 Visit http://localhost:3000 to test the application"
echo "🧪 Visit http://localhost:3000/test for testing interface"
echo "🔧 Backend API: http://localhost:5001"
echo "📊 API Endpoints:"
echo "   - GET / (API info)"
echo "   - GET /health (health check)"
echo "   - GET /predict/daily/<days> (daily predictions)"
echo "   - GET /predict/hourly/<hours> (hourly predictions)" 