# 🚌 Tryp Transit v0.2

**AI-Powered Transit Insights Platform**

Encourage public transit usage through real-time, AI-generated incentives based on traffic flow, cost comparisons, predicted bus ridership, and behavioral nudges.

## 🎯 App Goals

- **Reduce Car Dependency**: Provide compelling financial and time-based incentives to choose public transit
- **Real-Time Intelligence**: Combine traffic data, ridership predictions, and AI analysis for optimal recommendations
- **Cost Transparency**: Show clear dollar savings from choosing transit over driving
- **Alternative Routes**: Suggest optimal departure times and routes based on current conditions

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Next.js App   │    │  Python Service  │    │  External APIs  │
│   (Frontend)    │◄──►│  (Model Service) │    │                 │
│                 │    │                  │    │ • TomTom        │
│ • React UI      │    │ • Flask API      │    │ • OpenAI        │
│ • API Gateway   │    │ • Chronos T5     │    │                 │
│ • TypeScript    │    │ • Ridership ML   │    └─────────────────┘
└─────────────────┘    └──────────────────┘
```

### Components

- **Frontend**: Next.js 14 with TypeScript, Tailwind CSS
- **API Gateway**: `/api/transit-insights` - Unified endpoint for all transit data
- **Model Service**: Python Flask microservice with Chronos T5 forecasting
- **External APIs**: TomTom (traffic), OpenAI (AI analysis)

## 📋 API Contract

### POST `/api/transit-insights`

**Request:**
```json
{
  "departure": {
    "lat": 32.7913,
    "lng": -79.9353
  },
  "destination": {
    "lat": 32.7872,
    "lng": -79.9416
  },
  "timeToDestination": "14:30"
}
```

**Response:**
```json
{
  "travelTime": 25,
  "trafficDensity": "Medium",
  "costSavingsPerTrip": "$3.45",
  "additionalRides": [
    {
      "travelTime": 22,
      "trafficDensity": "Light"
    },
    {
      "travelTime": 28,
      "trafficDensity": "Heavy"
    },
    {
      "travelTime": 30,
      "trafficDensity": "Medium"
    }
  ]
}
```

### Model Service Endpoints

- `GET /` - API information and available endpoints
- `GET /health` - Health check endpoint
- `GET /predict/hourly/<int:hours_future>` - Hourly ridership predictions
- `GET /predict/daily/<int:days_future>` - Daily ridership predictions

**Example API calls:**
```bash
# Get API info
curl http://localhost:5001/

# Health check
curl http://localhost:5001/health

# Predict ridership for next 7 days
curl http://localhost:5001/predict/daily/7

# Predict ridership for next 24 hours
curl http://localhost:5001/predict/hourly/24
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Python 3.9+

### Option 1: Automated Startup (Recommended)

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/tryp_transit_v0.2.git
   cd tryp_transit_v0.2
   ```

2. **Run the startup script**
   ```bash
   chmod +x start-app.sh
   ./start-app.sh
   ```

3. **Open your browser**
   - Frontend: `http://localhost:3000`
   - Test page: `http://localhost:3000/test`
   - Backend API: `http://localhost:5001`

The startup script will:
- ✅ Check all prerequisites
- ✅ Install frontend dependencies
- ✅ Set up Python virtual environment
- ✅ Install backend dependencies
- ✅ Start both services automatically
- ✅ Handle cleanup on exit (Ctrl+C)

### Option 2: Manual Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/tryp_transit_v0.2.git
   cd tryp_transit_v0.2
   ```

2. **Set up environment variables** (optional for testing)
   ```bash
   # In src/.env.local
   OPENAI_API_KEY="your_openai_key"
   NEXT_PUBLIC_TOMTOM_API_KEY="your_tomtom_key"
   RIDERSHIP_API_BASE_URL="http://localhost:5001"
   ```

3. **Start the model service**
   ```bash
   cd model_service
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   python app.py  # Runs on port 5001
   ```

4. **Start the frontend** ⚠️ **IMPORTANT: Must run from src directory**
   ```bash
   cd src  # CRITICAL: Must be in src directory
   npm install
   npm run dev  # Runs on port 3000
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## 🔧 Troubleshooting

### Common Issues

**"Missing script: dev" error**
- **Cause**: Running `npm run dev` from wrong directory
- **Solution**: Ensure you're in the `src/` directory before running the command

**"ImportError: attempted relative import with no known parent package"**
- **Cause**: Running Python app directly instead of as module
- **Solution**: Use `python -m flask run` or run from parent directory

**Port 5000 already in use**
- **Cause**: macOS ControlCenter uses port 5000 by default
- **Solution**: The app now uses port 5001 for the backend

**403 Forbidden errors**
- **Cause**: Invalid or missing API keys
- **Solution**: Get valid API keys from TomTom and OpenAI, or use test endpoints
Get a TomTom API key from TomTom Developer Portal https://developer.tomtom.com/
Get an OpenAI API key from OpenAI Platform https://platform.openai.com/
Then update the .env.local file with real values.

### Testing Without External APIs

For testing without external API keys, use the simplified endpoints:

1. **Visit test page**: `http://localhost:3000/test`
2. **Test basic connectivity**: Click "Test Basic API"
3. **Test transit insights**: Click "Test Transit Insights" (uses mock data)

### Available Test Endpoints

- `GET /api/test` - Basic connectivity test
- `POST /api/transit-insights-simple` - Mock transit insights (no external APIs needed)

## 🐳 Docker Deployment

### Model Service
```bash
cd model_service
docker build -t tryp-model-service .
docker run -p 5001:5001 tryp-model-service
```

### Frontend
```bash
cd src
docker build -t tryp-frontend .
docker run -p 3000:3000 tryp-frontend
```

## ☁️ Cloud Deployment

### Vercel (Frontend)

1. **Connect your GitHub repository**
   - Push code to GitHub
   - Connect repository to Vercel

2. **Configure environment variables**
   ```bash
   OPENAI_API_KEY=your_openai_key
   NEXT_PUBLIC_TOMTOM_API_KEY=your_tomtom_key
   RIDERSHIP_API_BASE_URL=https://your-model-service-url.com
   ```

3. **Deploy**
   ```bash
   vercel --prod
   ```

### AWS (Model Service)

1. **Deploy to ECS**
   ```bash
   # Build and push Docker image
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-account.dkr.ecr.us-east-1.amazonaws.com
   docker build -t tryp-model-service .
   docker tag tryp-model-service:latest your-account.dkr.ecr.us-east-1.amazonaws.com/tryp-model-service:latest
   docker push your-account.dkr.ecr.us-east-1.amazonaws.com/tryp-model-service:latest
   
   # Deploy to ECS (use AWS Console or CLI)
   ```

2. **Configure load balancer**
   - Create Application Load Balancer
   - Point to ECS service
   - Update `RIDERSHIP_API_BASE_URL` in frontend

### Azure (Model Service)

1. **Deploy to Azure Container Instances**
   ```bash
   # Build and push to Azure Container Registry
   az acr build --registry yourregistry --image tryp-model-service .
   
   # Deploy to Container Instances
   az container create \
     --resource-group your-rg \
     --name tryp-model-service \
     --image yourregistry.azurecr.io/tryp-model-service:latest \
     --ports 5000 \
     --dns-name-label tryp-model-service
   ```

2. **Update frontend configuration**
   - Set `RIDERSHIP_API_BASE_URL` to your Azure endpoint

## 📊 Example Usage

1. **Select departure stop**: "Mary Street / Meeting Street"
2. **Select destination stop**: "King Street / Morris Street"  
3. **Set arrival time**: "14:30"
4. **Get insights**: View travel time, traffic density, cost savings, and alternative routes

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for AI analysis | Yes |
| `NEXT_PUBLIC_TOMTOM_API_KEY` | TomTom API key for traffic data | Yes |
| `RIDERSHIP_API_BASE_URL` | Model service base URL | Yes |

### Available Bus Stops

The app includes **60+ bus stops** across the greater Charleston metro area:

**Downtown Charleston**
- Mary Street / Meeting Street
- King Street / Morris Street
- Market Street / Meeting Street
- Calhoun Street / King Street
- Broad Street / East Bay Street
- Spring Street / Ashley Avenue
- Lockwood Drive / Beaufain Street
- Rutledge Avenue / Cannon Street
- East Bay Street / Queen Street
- King Street / Wentworth Street

**North Charleston**
- Rivers Avenue / Ashley Phosphate
- Rivers Avenue / Dorchester Road
- Northwoods Boulevard / Rivers Avenue
- Remount Road / Rivers Avenue
- Airport Terminal
- Tanger Outlets
- Charleston Southern University

**Mount Pleasant**
- Coleman Boulevard / Ben Sawyer
- Coleman Boulevard / Mathis Ferry
- Johnnie Dodds Boulevard / 17
- Mount Pleasant Towne Centre
- Isle of Palms Connector
- Shem Creek / Coleman

**West Ashley**
- Sam Rittenberg Boulevard / 17
- Sam Rittenberg Boulevard / Glenn McConnell
- West Ashley Circle
- Citadel Mall
- Ashley River Road / 61
- Bees Ferry Road / 17

**Additional Areas**: James Island, Daniel Island, Johns Island, Sullivan's Island, Isle of Palms, Folly Beach, Kiawah Island, Summerville, Goose Creek, Hanahan, Ladson, Moncks Corner

## 🚀 Next Steps: Taking MVP to Production

### Phase 1: Enhanced Features (Weeks 1-2)
- [ ] **Real-time GPS tracking** integration with actual bus systems
- [ ] **User authentication** and personalized recommendations
- [ ] **Push notifications** for optimal departure times
- [ ] **Mobile app** development (React Native)
- [ ] **Payment integration** for transit passes and incentives

### Phase 2: Advanced Analytics (Weeks 3-4)
- [ ] **Machine learning model** for personalized route optimization
- [ ] **Predictive analytics** for demand forecasting
- [ ] **A/B testing framework** for incentive optimization
- [ ] **Real-time dashboard** for transit operators
- [ ] **Integration with existing transit APIs** (GTFS, real-time feeds)

### Phase 3: Business Features (Weeks 5-6)
- [ ] **Corporate partnerships** for employee transit programs
- [ ] **Loyalty program** with points and rewards
- [ ] **Carbon footprint tracking** and environmental impact
- [ ] **Multi-city expansion** framework
- [ ] **API marketplace** for third-party integrations

### Phase 4: Scale & Monetization (Weeks 7-8)
- [ ] **SaaS platform** for transit agencies
- [ ] **White-label solution** for municipalities
- [ ] **Data analytics services** for urban planning
- [ ] **Partnership with ride-sharing** for first/last mile solutions
- [ ] **International expansion** planning

### Technical Roadmap
- [ ] **Microservices architecture** for better scalability
- [ ] **Real-time data streaming** with Apache Kafka
- [ ] **Advanced caching** with Redis
- [ ] **CI/CD pipeline** with automated testing
- [ ] **Monitoring and alerting** with Prometheus/Grafana
- [ ] **Security audit** and compliance (SOC 2, GDPR)

### Business Development
- [ ] **Pilot programs** with local transit agencies
- [ ] **Partnership with employers** for commuter benefits
- [ ] **Government grants** for sustainable transportation
- [ ] **Investor pitch deck** and funding rounds
- [ ] **Customer acquisition** strategy

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support, email support@tryptransit.com or create an issue in this repository.
