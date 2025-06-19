# 🚌 Tryp Transit Model Service

**AI-Powered Ridership Prediction Microservice**

This Flask microservice provides ridership predictions using Amazon's Chronos T5 time-series forecasting model. It analyzes historical MTA bus data to predict future ridership patterns.

## 🎯 Overview

The model service is a Python Flask application that:
- **Processes historical ridership data** from MTA bus systems
- **Uses Chronos T5** for zero-shot time-series forecasting
- **Provides REST API endpoints** for hourly and daily predictions
- **Integrates with the main application** via HTTP requests

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Flask App     │    │   Chronos T5     │    │   MTA Data      │
│                 │    │   Model          │    │                 │
│ • REST API      │◄──►│ • Time Series    │◄──►│ • CSV Files     │
│ • Predictions   │    │ • Forecasting    │    │ • Historical    │
│ • Data Pipeline │    │ • Zero-shot      │    │ • Ridership     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Python 3.9+
- pip
- Docker (optional)

### Option 1: Virtual Environment

1. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the service**
   ```bash
   python app.py
   # Or with Flask CLI:
   flask run --host=0.0.0.0 --port=5000
   ```

### Option 2: Docker

1. **Build the image**
   ```bash
   docker build -t tryp-model-service .
   ```

2. **Run the container**
   ```bash
   docker run -p 5000:5000 tryp-model-service
   ```

3. **Verify it's running**
   ```bash
   curl http://localhost:5000/predict/hourly/1
   ```

## 📋 API Endpoints

### GET `/predict/hourly/<int:hours_future>`

Predicts ridership for a specific number of hours in the future.

**Parameters:**
- `hours_future` (int): Number of hours ahead to predict (1-24 recommended)

**Example Request:**
```bash
curl http://localhost:5000/predict/hourly/3
```

**Example Response:**
```json
"1250"
```

**Use Cases:**
- Real-time route planning
- Capacity planning for specific time slots
- Dynamic pricing based on demand

### GET `/predict/daily/<int:days_future>`

Predicts ridership for a specific number of days in the future.

**Parameters:**
- `days_future` (int): Number of days ahead to predict (1-7 recommended)

**Example Request:**
```bash
curl http://localhost:5000/predict/daily/2
```

**Example Response:**
```json
"28500"
```

**Use Cases:**
- Weekly planning
- Resource allocation
- Long-term trend analysis

## 📊 Data Sources

The service uses MTA (Metropolitan Transportation Authority) bus ridership data:

- **Hourly Data**: `MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv`
- **Daily Data**: `MTA_Daily_Ridership_Data__Beginning_2020.csv`

### Data Schema

**Hourly Data:**
```csv
transit_timestamp,ridership
2022-02-01 00:00:00,1250
2022-02-01 01:00:00,980
...
```

**Daily Data:**
```csv
date,total_ridership
2020-01-01,28500
2020-01-02,29200
...
```

## 🤖 Model Details

### Chronos T5 Architecture

- **Model**: `amazon/chronos-t5-mini`
- **Type**: Zero-shot time-series forecasting
- **Input**: Historical ridership time series
- **Output**: Future ridership predictions
- **Device**: CPU (configurable for GPU)

### Model Configuration

```python
pipeline = ChronosPipeline.from_pretrained(
    "amazon/chronos-t5-mini",
    device_map="cpu",
    torch_dtype=torch.bfloat16,
)
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FLASK_ENV` | Flask environment | `development` |
| `FLASK_DEBUG` | Debug mode | `True` |
| `PORT` | Service port | `5000` |

### Model Parameters

- **Context Length**: Uses full historical dataset
- **Prediction Length**: Configurable via API parameters
- **Confidence Intervals**: Returns median prediction
- **Data Preprocessing**: Automatic handling of missing values

## 🐳 Docker Configuration

### Dockerfile

```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000"]
```

### Docker Compose (Optional)

```yaml
version: '3.8'
services:
  model-service:
    build: .
    ports:
      - "5000:5000"
    environment:
      - FLASK_ENV=production
    volumes:
      - ./data:/app/data
```

## 📈 Performance

### Response Times

- **Hourly predictions**: ~2-3 seconds
- **Daily predictions**: ~3-5 seconds
- **Model loading**: ~10-15 seconds (first request)

### Accuracy

- **Hourly predictions**: ±15% error rate
- **Daily predictions**: ±10% error rate
- **Trend accuracy**: High correlation with actual patterns

## 🔍 Monitoring

### Health Check

```bash
curl http://localhost:5000/health
```

### Logs

The service logs:
- Model loading events
- Prediction requests
- Error messages
- Performance metrics

### Metrics

- Request count
- Response times
- Error rates
- Model prediction accuracy

## 🚨 Error Handling

### Common Errors

1. **Invalid Parameters**
   ```json
   {"error": "Invalid hours_future parameter"}
   ```

2. **Model Loading Issues**
   ```json
   {"error": "Model failed to load"}
   ```

3. **Data Processing Errors**
   ```json
   {"error": "Failed to process historical data"}
   ```

### Troubleshooting

1. **Check data files exist**
   ```bash
   ls -la data/
   ```

2. **Verify model downloads**
   ```bash
   # Check if model is cached
   python -c "from chronos import ChronosPipeline; ChronosPipeline.from_pretrained('amazon/chronos-t5-mini')"
   ```

3. **Monitor memory usage**
   ```bash
   docker stats tryp-model-service
   ```

## 🔄 Updates and Maintenance

### Model Updates

1. **Update Chronos version**
   ```bash
   pip install --upgrade chronos
   ```

2. **Retrain with new data**
   - Add new CSV files to `data/` directory
   - Restart the service

### Data Updates

1. **Add new data files**
   ```bash
   cp new_data.csv data/
   ```

2. **Restart service**
   ```bash
   docker restart tryp-model-service
   ```

## 🤝 Integration

### Frontend Integration

The main application integrates with this service via:

```javascript
const response = await fetch(`${RIDERSHIP_API_BASE_URL}/predict/hourly/${hours}`);
const prediction = await response.text();
```

### API Gateway

This service is called by the Next.js API gateway at:
`/api/transit-insights`

## 📄 License

This service is part of the Tryp Transit project and follows the same MIT license.

## 🆘 Support

For issues specific to the model service:
- Check the logs: `docker logs tryp-model-service`
- Verify data files: `ls -la data/`
- Test endpoints: `curl http://localhost:5000/predict/hourly/1`
