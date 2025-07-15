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
pipeline_daily = None
df_daily = None

def load_daily_model():
    global pipeline_daily
    try:
        print("Loading daily Chronos model...")
        from chronos import ChronosPipeline
        pipeline_daily = ChronosPipeline.from_pretrained("amazon/chronos-t5-mini", device_map="cpu", torch_dtype=torch.float32)
        print("✓ Daily Chronos model loaded successfully")
    except ImportError:
        print("⚠️  Chronos forecasting not available - using mock predictions")
        pipeline_daily = "mock"
    except Exception as e:
        print(f"❌ Error loading daily Chronos model: {e}")
        pipeline_daily = "mock"

def load_daily_data():
    global df_daily
    try:
        print("Loading daily data from data/MTA_Daily_Ridership_Data__Beginning_2020.csv...")
        df_daily_raw = pd.read_csv("data/MTA_Daily_Ridership_Data__Beginning_2020.csv")
        df_daily_raw['Date'] = pd.to_datetime(df_daily_raw['Date'])
        df_daily_raw = df_daily_raw.sort_values('Date')
        df_daily = df_daily_raw.copy()
        print(f"✓ Daily data loaded: {len(df_daily)} records")
    except Exception as e:
        print(f"❌ Error loading daily data: {e}")
        df_daily = pd.DataFrame()

def predict(days_future):
    """Main prediction function used by the Flask API."""
    global pipeline_daily, df_daily
    
    if pipeline_daily is None:
        load_daily_model()
    
    if df_daily is None:
        load_daily_data()
    
    if pipeline_daily == "mock" or df_daily.empty:
        # Return mock prediction when Chronos is not available
        base_ridership = 10000
        variation = np.random.randint(-2000, 2000)
        return int(base_ridership + variation)
    
    try:
        # Find the appropriate ridership column
        ridership_col = None
        for col in df_daily.columns:
            if 'ridership' in col.lower() or 'total' in col.lower():
                ridership_col = col
                break
        
        if ridership_col is None:
            print("⚠️  No ridership column found, using mock prediction")
            base_ridership = 10000
            variation = np.random.randint(-2000, 2000)
            return int(base_ridership + variation)
            
        ridership_values = df_daily[ridership_col].values
        ridership_tensor = torch.tensor(ridership_values, dtype=torch.float32)
        
        # Make prediction
        forecast = pipeline_daily.predict(ridership_tensor, prediction_length=days_future)
        last_prediction = forecast[0, -1, 0].item()
        
        return int(last_prediction)
        
    except Exception as e:
        print(f"❌ Error in daily prediction: {e}")
        # Return mock prediction on error
        base_ridership = 10000
        variation = np.random.randint(-2000, 2000)
        return int(base_ridership + variation)

# Load model and data when module is imported
load_daily_model()
load_daily_data()
