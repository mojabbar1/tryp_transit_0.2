#
# Model: https://huggingface.co/amazon/chronos-t5-mini
#

import pandas as pd
import numpy as np
import torch
from datetime import datetime, timedelta
import warnings
import os

# Global variables for model and data
pipeline_hourly = None
df_hourly = None

def load_hourly_model():
    global pipeline_hourly
    try:
        print("Loading hourly Chronos model...")
        from chronos import ChronosPipeline
        pipeline_hourly = ChronosPipeline.from_pretrained("amazon/chronos-t5-mini", device_map="cpu", torch_dtype=torch.float32)
        print("✓ Hourly Chronos model loaded successfully")
    except ImportError:
        print("⚠️  Chronos forecasting not available - using mock predictions")
        pipeline_hourly = "mock"
    except Exception as e:
        print(f"❌ Error loading hourly Chronos model: {e}")
        pipeline_hourly = "mock"

def load_hourly_data():
    global df_hourly
    try:
        print("Loading hourly data from data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv...")
        df_hourly_raw = pd.read_csv("data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv")
        df_hourly_raw['transit_timestamp'] = pd.to_datetime(df_hourly_raw['transit_timestamp'])
        df_hourly_raw = df_hourly_raw.sort_values('transit_timestamp')
        df_hourly = df_hourly_raw.copy()
        print(f"✓ Hourly data loaded: {len(df_hourly)} records")
    except Exception as e:
        print(f"❌ Error loading hourly data: {e}")
        df_hourly = pd.DataFrame()

def predict(hours_future):
    """Main prediction function used by the Flask API."""
    global pipeline_hourly, df_hourly
    
    if pipeline_hourly is None:
        load_hourly_model()
    
    if df_hourly is None:
        load_hourly_data()
    
    if pipeline_hourly == "mock" or df_hourly.empty:
        # Return mock prediction when Chronos is not available
        base_ridership = 50
        variation = np.random.randint(-20, 20)
        return int(base_ridership + variation)
    
    try:
        if 'ridership' not in df_hourly.columns:
            print("⚠️  No ridership column found, using mock prediction")
            base_ridership = 50
            variation = np.random.randint(-20, 20)
            return int(base_ridership + variation)
            
        ridership_values = df_hourly['ridership'].values
        ridership_tensor = torch.tensor(ridership_values, dtype=torch.float32)
        
        # Make prediction
        forecast = pipeline_hourly.predict(ridership_tensor, prediction_length=hours_future)
        last_prediction = forecast[0, -1, 0].item()
        
        return int(last_prediction)
        
    except Exception as e:
        print(f"❌ Error in hourly prediction: {e}")
        # Return mock prediction on error
        base_ridership = 50
        variation = np.random.randint(-20, 20)
        return int(base_ridership + variation)

# Load model and data when module is imported
load_hourly_model()
load_hourly_data()

def build_df():
    """Return pre-loaded hourly ridership series."""
    print("Accessing pre-loaded hourly ridership series")
    return df_hourly['ridership']

def chronos_forecast(target, hours_into_future):
    """
    Zero-shot chronos run on dataframe for time-series prediction.
    Using globally loaded pipeline_hourly instead of loading each time.
    """
    print("Running chronos pipeline on pre-loaded model")
    # Using globally loaded pipeline_hourly
    
    context = torch.tensor(target)
    forecast = pipeline_hourly.predict(context, hours_into_future, limit_prediction_length=False)
    median = np.quantile(forecast[0].numpy(), [0.5], axis=0)
    return median[-1][-1]

def predict_chronos(hours_into_future) -> float:
    if hours_into_future <= 0:
        return 0
    return floor(chronos_forecast(build_df(), hours_into_future))
