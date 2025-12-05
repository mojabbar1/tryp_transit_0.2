/**
 * Ridership prediction API client
 * Calls the Python model service for ML predictions
 */

import axios from 'axios';

const RIDERSHIP_API_BASE_URL = process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001';

export interface RidershipPrediction {
  prediction: number;
  source: 'model' | 'mock';
}

/**
 * Get predicted hourly ridership for a future time
 * @param hoursFromNow - Number of hours into the future
 * @returns Predicted ridership count or null if unavailable
 */
export async function getPredictedRidership(hoursFromNow: number): Promise<number | null> {
  if (hoursFromNow <= 0) {
    console.log('Skipping ridership prediction for immediate departure');
    return null;
  }

  try {
    const url = `${RIDERSHIP_API_BASE_URL}/predict/hourly/${hoursFromNow}`;
    console.log(`Calling ridership API: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        Accept: 'application/json',
      },
    });

    // Handle different possible response formats from Python service
    let prediction: number | null = null;

    if (typeof response.data === 'number') {
      prediction = response.data;
    } else if (response.data && typeof response.data.prediction === 'number') {
      prediction = response.data.prediction;
    } else if (Array.isArray(response.data) && response.data.length > 0) {
      prediction = response.data[0];
    }

    console.log(`Ridership prediction: ${prediction}`);
    return prediction;
  } catch (error) {
    console.error('Ridership API call failed:', {
      error: error instanceof Error ? error.message : String(error),
      url: `${RIDERSHIP_API_BASE_URL}/predict/hourly/${hoursFromNow}`,
      hours: hoursFromNow,
    });
    return null;
  }
}

/**
 * Check if the ridership service is available
 */
export async function checkRidershipServiceHealth(): Promise<boolean> {
  try {
    await axios.get(`${RIDERSHIP_API_BASE_URL}/health`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
