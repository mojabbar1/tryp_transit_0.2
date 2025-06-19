# Tryp Transit v0.2 - Quick Setup Guide

## 🚀 Getting Started

This is the clean, production-ready version of Tryp Transit. All legacy files and duplicate directories have been removed.

### Prerequisites
- Node.js 18+ 
- Python 3.11+
- npm or yarn

### Quick Start (Automated - Recommended)

1. **Clone and navigate to the project:**
   ```bash
   cd tryp_transit_v0.2
   ```

2. **Run the automated startup script:**
   ```bash
   chmod +x start-app.sh
   ./start-app.sh
   ```

3. **Test the application:**
   - Main app: http://localhost:3000
   - Test interface: http://localhost:3000/test
   - Backend API: http://localhost:5001

The startup script will automatically:
- ✅ Check all prerequisites
- ✅ Install frontend dependencies
- ✅ Set up Python virtual environment
- ✅ Install backend dependencies
- ✅ Start both services
- ✅ Handle cleanup on exit (Ctrl+C)

### Manual Setup (Alternative)

1. **Clone and navigate to the project:**
   ```bash
   cd tryp_transit_v0.2
   ```

2. **Set up the frontend:**
   ```bash
   cd src
   npm install
   ```

3. **Set up the model service:**
   ```bash
   cd ../model_service
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Start both services:**
   
   **Terminal 1 - Model Service:**
   ```bash
   cd model_service
   source venv/bin/activate
   python app.py  # Runs on port 5001
   ```
   
   **Terminal 2 - Frontend:**
   ```bash
   cd src
   npm run dev  # Runs on port 3000
   ```

5. **Test the application:**
   - Main app: http://localhost:3000
   - Test interface: http://localhost:3000/test
   - Backend API: http://localhost:5001

### 🛑 Stopping the Application

**Option 1 - If using automated startup:**
- Press `Ctrl+C` in the terminal running `./start-app.sh`

**Option 2 - Manual cleanup:**
```bash
./stop-app.sh
```

### 🧪 Testing

Run the test script to verify everything is set up correctly:
```bash
./test-setup.sh
```

### 📁 Clean Directory Structure

```
tryp_transit_v0.2/
├── src/                    # Next.js frontend
├── model_service/          # Python Flask API
├── start-app.sh           # Automated startup script
├── stop-app.sh            # Stop services script
├── test-setup.sh          # Setup verification script
├── README.md              # Comprehensive documentation
├── changes.md             # Development history
├── LICENSE                # MIT License
├── .gitignore            # Git ignore rules
└── SETUP.md              # This file
```

### 🔧 Environment Variables

Create `.env.local` in the `src/` directory (optional for testing):
```env
OPENAI_API_KEY=your_openai_key
NEXT_PUBLIC_TOMTOM_API_KEY=your_tomtom_key
RIDERSHIP_API_BASE_URL=http://localhost:5001
```

### 🐳 Docker Deployment

See `README.md` for detailed Docker and cloud deployment instructions.

### 📚 Documentation

- `README.md` - Comprehensive project documentation
- `changes.md` - Development history and changes
- `model_service/README.md` - Model service specific docs

---

**Ready for production demos and immediate use! 🎉** 