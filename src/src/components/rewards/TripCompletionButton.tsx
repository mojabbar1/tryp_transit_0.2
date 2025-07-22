'use client';

import React, { useState } from 'react';
import { MapPin, Loader2, CheckCircle, Beer, Zap } from 'lucide-react';

interface TripCompletionButtonProps {
  userId: string;
  userName: string;
  onTripCompleted: (result: any) => void;
  disabled?: boolean;
  beerProgress?: {
    completed: number;
    required: number;
    percentage: number;
  };
}

export default function TripCompletionButton({
  userId,
  userName,
  onTripCompleted,
  disabled = false,
  beerProgress
}: TripCompletionButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<Date | null>(null);

  const isAlmostBeer = beerProgress && beerProgress.completed >= beerProgress.required - 1;
  const isHighProgress = beerProgress && beerProgress.percentage >= 80;

  const handleTripCompletion = async () => {
    if (isLoading || disabled) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/complete-trip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          userName
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to complete trip');
      }

      const result = await response.json();
      setLastCompleted(new Date());
      onTripCompleted(result);

    } catch (error) {
      console.error('Trip completion error:', error);
      // Still call the callback with a fallback result
      onTripCompleted({
        success: false,
        error: 'Failed to complete trip, but progress is still tracked',
        fallbackMessage: 'Your trip has been recorded. Rewards will update shortly.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getButtonText = () => {
    if (isLoading) return 'Recording Trip...';
    if (lastCompleted) return 'Trip Completed!';
    if (isAlmostBeer) return '🍺 Complete Trip → Earn FREE BEER!';
    if (isHighProgress) return '🔥 Complete Trip → Almost There!';
    return 'Complete Transit Trip';
  };

  const getButtonStyle = () => {
    if (disabled) {
      return 'bg-gray-300 text-gray-500 cursor-not-allowed';
    }
    if (lastCompleted) {
      return 'bg-green-500 text-white';
    }
    if (isAlmostBeer) {
      return 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg hover:shadow-xl';
    }
    if (isHighProgress) {
      return 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg hover:shadow-xl';
    }
    return 'bg-blue-600 text-white hover:bg-blue-700';
  };

  return (
    <div className="space-y-4">
      {/* Progress indicator for beer rewards */}
      {beerProgress && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Beer className="w-5 h-5 text-amber-600" />
              <span className="font-medium text-amber-800">
                FREE BEER Progress
              </span>
            </div>
            <span className="text-lg font-bold text-amber-600">
              {beerProgress.completed}/{beerProgress.required}
            </span>
          </div>
          
          <div className="w-full bg-amber-200 rounded-full h-3 mb-2">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500"
              style={{ width: `${beerProgress.percentage}%` }}
            />
          </div>
          
          {isAlmostBeer ? (
            <p className="text-sm text-amber-800 font-medium text-center animate-pulse">
              🍺 Just 1 more trip for your FREE BEER!
            </p>
          ) : (
            <p className="text-sm text-amber-700 text-center">
              {beerProgress.required - beerProgress.completed} more trips until FREE BEER
            </p>
          )}
        </div>
      )}

      {/* Main completion button */}
      <button
        onClick={handleTripCompletion}
        disabled={disabled || isLoading}
        className={`
          w-full py-4 px-6 rounded-lg font-semibold text-lg transition-all duration-300
          ${getButtonStyle()}
          ${isAlmostBeer ? 'animate-pulse' : ''}
          ${!disabled && !isLoading ? 'hover:scale-105 active:scale-95' : ''}
          disabled:transform-none
        `}
      >
        <div className="flex items-center justify-center space-x-2">
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : lastCompleted ? (
            <CheckCircle className="w-5 h-5" />
          ) : isAlmostBeer ? (
            <Beer className="w-5 h-5" />
          ) : isHighProgress ? (
            <Zap className="w-5 h-5" />
          ) : (
            <MapPin className="w-5 h-5" />
          )}
          <span>{getButtonText()}</span>
        </div>
      </button>

      {/* Last completion indicator */}
      {lastCompleted && (
        <div className="text-center text-sm text-gray-600">
          <p>Trip completed at {lastCompleted.toLocaleTimeString()}</p>
          <p className="text-xs text-gray-500 mt-1">
            Rewards updated • Check your progress above
          </p>
        </div>
      )}

      {/* Special beer messaging */}
      {isAlmostBeer && !lastCompleted && (
        <div className="bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 rounded-lg p-3">
          <div className="text-center">
            <p className="text-amber-800 font-medium text-sm">
              🍺 You're about to earn your FREE BEER!
            </p>
            <p className="text-amber-700 text-xs mt-1">
              Complete this trip and celebrate your week of smart commuting
            </p>
          </div>
        </div>
      )}

      {/* Demo instructions */}
      <div className="bg-gray-100 rounded-lg p-3">
        <h4 className="text-sm font-medium text-gray-700 mb-1">
          🎯 Demo Instructions:
        </h4>
        <p className="text-xs text-gray-600">
          Click to simulate completing a transit trip. This will update reward progress 
          and may trigger celebration modals for earned rewards.
        </p>
      </div>
    </div>
  );
}