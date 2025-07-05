from flask import Flask, jsonify, request
import logging
import traceback
from bus_daily_chronos_t5_tiny import predict as predict_daily
from bus_hourly_chronos_t5_tiny import predict as predict_hourly

from datetime import datetime

app = Flask(__name__)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    try:
        logger.info(f"Hourly prediction request for {hours_future} hours")
        result = predict_hourly(hours_future)
        logger.info(f"Hourly prediction successful: {result}")
        return jsonify({
            "prediction": result,
            "hours_future": hours_future,
            "model_type": "hourly",
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        error_msg = f"Hourly prediction failed for {hours_future} hours"
        logger.error(f"{error_msg}: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            "error": "Hourly prediction failed",
            "details": str(e),
            "hours_requested": hours_future,
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/predict/daily/<int:days_future>')
def predict_daily_ridership(days_future):
    try:
        logger.info(f"Daily prediction request for {days_future} days")
        result = predict_daily(days_future)
        logger.info(f"Daily prediction successful: {result}")
        return jsonify({
            "prediction": result,
            "days_future": days_future,
            "model_type": "daily",
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        error_msg = f"Daily prediction failed for {days_future} days"
        logger.error(f"{error_msg}: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            "error": "Daily prediction failed", 
            "details": str(e),
            "days_requested": days_future,
            "timestamp": datetime.now().isoformat()
        }), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
