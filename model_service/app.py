from flask import Flask, jsonify
from bus_daily_chronos_t5_tiny import predict as predict_daily
from bus_hourly_chronos_t5_tiny import predict as predict_hourly

from datetime import datetime

app = Flask(__name__)

@app.route('/')
def root():
    return jsonify({
        "message": "Tryp Transit Model Service API",
        "version": "v0.2",
        "endpoints": {
            "health": "/health",
            "hourly_prediction": "/predict/hourly/<hours_future>",
            "daily_prediction": "/predict/daily/<days_future>"
        },
        "status": "running"
    })

@app.route('/health')
def health():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "tryp-transit-model-service"
    })

@app.route('/predict/hourly/<int:hours_future>')
def predict_hourly_ridership(hours_future):
    return str(predict_hourly(hours_future))

@app.route('/predict/daily/<int:days_future>')
def predict_daily_ridership(days_future):
    return str(predict_daily(days_future))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
