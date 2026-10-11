# Tryp Transit v0.2 - Quick Setup Guide

## 🚀 Getting Started

This is the clean, production-ready version of Tryp Transit. All legacy files and duplicate directories have been removed.

### Prerequisites
- Node.js 22+ (required by the `openai` 7 SDK; CI uses Node 22)
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
   - Health check page: http://localhost:3000/test (shows `GET /api/health`)
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
   - Health check page: http://localhost:3000/test (shows `GET /api/health`)
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

Frontend checks (from `src/`, the same ones CI runs):
```bash
npm run lint              # ESLint 9 CLI with src/eslint.config.mjs (`next lint` was removed in Next 16)
npm run typecheck         # tsc --noEmit
npm test                  # Jest unit and route tests
npm run test:integration  # next build, then HTTP integration checks (below)
```

#### HTTP integration checks (`npm run test:integration`)

Builds the production app once (`next build`) and runs `next start` on `127.0.0.1` (an OS-assigned port) once per
scenario, against a strict **synthetic** data agent from `src/__tests__/integration/` on its own loopback port. Each
scenario gets a fresh server, so cached stops, facts and stats never carry over. Scenarios: data agent healthy; data
agent answering 503, malformed bodies, never answering, or dropping connections; data agent disabled.

What it asserts, through the app's own response schemas:
- A trip with picked stop ids at their own coordinates gets the scheduled minutes, leave-by time, three alternatives,
  and citations (feed and the access-buffer fact); lat/lng alone maps to the nearest stops; an answer from another
  feed version, a stop id away from its point, or an unknown id gives no trip.
- A schedule reason, or no trip, is `unavailable`: no minutes, departures or alternatives. A malformed, 503 or
  timed-out answer is degraded, never invented.
- With the agent off or failing: stops are the approximate places labeled as places, the trip is degraded, stats are
  unavailable, and the fact pages flag the 05 §2 fallback. Disabled means zero requests to the agent.
- `/dashboard` shows only cited stats (an uncited one is dropped) or "Data unavailable", never the old 2,847 / 89.3%
  figures; the cost and CO2 pages cite each fact; demo off shows no rewards, demo banner, or demo route.
- Every request to the synthetic agent is a GET on a contract path with the contract's parameters, and no server log
  carries one of the synthetic stop ids or coordinates.

Requirements: `npm ci` done, Node 22 or later, and `git` (to verify build reuse). No Docker, database, data agent,
API key, or network access: the whole run, build included, needs only loopback. The first run builds (about a minute)
and overwrites `src/.next` as `npm run build` does, leaving a **test build** there (pinned settings, test font
fixture), so run `npm run build` again before `npm start`. Later runs reuse that build only if this command made it
and nothing it depends on changed: files under `src/` outside `__tests__/`, the font fixture and child guard, the Next
and Node versions, and the build's settings and environment. `TEST_INTEGRATION_REBUILD=1` forces a build; a failed
build never leaves a reusable marker.

Isolation: the servers get only `PATH`, `HOME`, temp-dir and locale variables from your shell, plus pinned settings:
`LLM_PROVIDER=none`, every key blank, `DATA_AGENT_*` per scenario, and `NEXT_PUBLIC_DEMO_MODE=false`. These override
any `.env*` file in `src/`, and `/api/health` confirms no LLM or traffic provider. `NEXT_PUBLIC_DEMO_MODE` is inlined
when the app is built, so it is set for the build itself; changing it later has no effect without a rebuild. A
preloaded guard makes every non-loopback connection from the servers fail, and the run fails if one is attempted.
Each server is stopped after its scenario; if the run is interrupted or killed, its servers exit when the run's pipe
to them closes.

Offline build: `next build` runs with the same pinned environment and guard, plus, in that child's environment only
(never `.env*`, never `npm run build`):
- `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, Next's own next/font/google test hook, pointing at
  `src/__tests__/integration/fixtures/google-fonts-offline.js`. It answers the layout's one Poppins stylesheet URL with
  `local()` faces only, so Next neither requests fonts.googleapis.com nor downloads a font file, and no font is
  committed. A changed font call fails the build until the fixture is updated.
- Every proxy variable (`HTTP(S)_PROXY`, `ALL_PROXY`) pointing at a loopback trap that refuses and records each
  connection. The Node guard can't see Turbopack's native HTTP client; this catches it.
- `INTEGRATION_OFFLINE_BUILD=1`, which `src/next.config.mjs` reads to turn off Turbopack's persistent build cache for
  this build only, so a cached ordinary build can't replay its Google Fonts request here and the test font never
  enters the ordinary build's cache. Without the variable the config is unchanged.

The run fails, writing no marker, if the guard blocks anything during the build or the trap gets any connection,
even when the build itself succeeds. Guarantee: no Node code in the build or the servers opens a non-loopback TCP/TLS
connection (it is refused before any DNS lookup), and Turbopack's HTTP client reaches nothing but the trap. Not
covered by these guards: native code that ignores the proxy variables (none is known here). P4b verified the whole
run cold (no `src/.next`) and with a reused build under macOS `sandbox-exec` allowing only loopback; CI's runner has
no such sandbox, so there the guards are the enforcement.

Limits: HTTP-level checks only, not a browser or UI test (client-rendered text, such as the stop picker's
"approximate locations" note, isn't exercised). Every upstream answer is synthetic, so this validates nothing about the
real data agent, CARTA data, a GTFS feed, or fact approvals, and it changes no activation gate. The test build uses
the font fixture, so typography isn't checked (Poppins renders only if installed locally, otherwise Next's generated
fallback); production builds still fetch and self-host the real Google font.

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
OPENAI_API_KEY=your_openai_key       # optional: without an LLM key, narration uses the template
TOMTOM_API_KEY=your_tomtom_key
# NEXT_PUBLIC_DEMO_MODE=true         # enables the demo scenarios
```
See `src/.env.example` for every setting. The web app doesn't call `model_service`.

### 🐳 Docker Deployment

See `README.md` for detailed Docker and cloud deployment instructions.

### 📚 Documentation

- `README.md` - Comprehensive project documentation
- `changes.md` - Development history and changes
- `model_service/README.md` - Model service specific docs

---

**Ready for production demos and immediate use! 🎉** 