'use client';

import React from 'react';
import { AlertCircle, Zap, TrendingUp, Beer } from 'lucide-react';
import { UrgencyLevel, RewardType } from '@/types/interfaces';

interface NudgeMessageCardProps {
  message: string;
  urgencyLevel: UrgencyLevel;
  relevantReward?: {
    rewardType: RewardType;
    title: string;
    partnerId: string;
  } | null;
  beerContext?: {
    contextType: string;
    isOptimalTime: boolean;
    timeOfDay: string;
  };
}

const getUrgencyConfig = (urgencyLevel: UrgencyLevel) => {
  switch (urgencyLevel) {
    case UrgencyLevel.HIGH:
      return {
        icon: <Zap className="w-5 h-5" />,
        bg: 'bg-gradient-to-r from-red-50 to-orange-50',
        border: 'border-red-200',
        text: 'text-red-800',
        iconColor: 'text-red-600',
        badge: 'bg-red-100 text-red-800',
        animation: 'animate-pulse'
      };
    case UrgencyLevel.MEDIUM:
      return {
        icon: <TrendingUp className="w-5 h-5" />,
        bg: 'bg-gradient-to-r from-yellow-50 to-amber-50',
        border: 'border-yellow-200',
        text: 'text-yellow-800',
        iconColor: 'text-yellow-600',
        badge: 'bg-yellow-100 text-yellow-800',
        animation: ''
      };
    case UrgencyLevel.LOW:
      return {
        icon: <AlertCircle className="w-5 h-5" />,
        bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
        border: 'border-blue-200',
        text: 'text-blue-800',
        iconColor: 'text-blue-600',
        badge: 'bg-blue-100 text-blue-800',
        animation: ''
      };
    default:
      return {
        icon: <AlertCircle className="w-5 h-5" />,
        bg: 'bg-gray-50',
        border: 'border-gray-200',
        text: 'text-gray-800',
        iconColor: 'text-gray-600',
        badge: 'bg-gray-100 text-gray-800',
        animation: ''
      };
  }
};

const getBeerContextMessage = (contextType: string) => {
  switch (contextType) {
    case 'TGIF_HAPPY_HOUR':
      return '🍻 Perfect timing for Friday happy hour!';
    case 'WEEKEND_RELAXATION':
      return '🍺 Great way to enjoy your weekend!';
    case 'WEEKDAY_UNWIND':
      return '🍺 Perfect way to unwind after work!';
    case 'LATE_NIGHT_SOCIAL':
      return '🍺 Great for a nightcap with friends!';
    default:
      return '🍺 Enjoy a well-deserved beer!';
  }
};

export default function NudgeMessageCard({
  message,
  urgencyLevel,
  relevantReward,
  beerContext
}: NudgeMessageCardProps) {
  const config = getUrgencyConfig(urgencyLevel);
  const isBeerReward = relevantReward?.rewardType === RewardType.FREE_BEER;
  const isOptimalBeerTime = beerContext?.isOptimalTime || false;

  return (
    <div className={`
      relative p-4 rounded-lg border-2 shadow-lg transition-all duration-300
      ${config.bg} ${config.border}
      ${config.animation}
      ${isBeerReward ? 'ring-2 ring-amber-300 ring-opacity-50' : ''}
      hover:shadow-xl
    `}>
      {/* Beer reward special indicator */}
      {isBeerReward && (
        <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full shadow-md">
          🍺 BEER
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className={config.iconColor}>
            {config.icon}
          </span>
          <span className={`text-sm font-medium ${config.text}`}>
            {urgencyLevel.toUpperCase()} PRIORITY
          </span>
        </div>
        
        {isBeerReward && (
          <Beer className="w-5 h-5 text-amber-600" />
        )}
      </div>

      {/* Main Message */}
      <div className="mb-4">
        <p className={`text-lg font-medium leading-relaxed ${config.text}`}>
          {message}
        </p>
      </div>

      {/* Beer Context Enhancement */}
      {isBeerReward && beerContext && isOptimalBeerTime && (
        <div className="mb-3 p-3 bg-amber-100 border border-amber-300 rounded-md">
          <p className="text-sm text-amber-800 font-medium text-center">
            {getBeerContextMessage(beerContext.contextType)}
          </p>
        </div>
      )}

      {/* Reward Information */}
      {relevantReward && (
        <div className={`p-3 rounded-md ${config.badge} border border-current border-opacity-20`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Target Reward:
            </span>
            <span className="text-sm font-bold">
              {relevantReward.title}
            </span>
          </div>
          
          {isBeerReward && (
            <div className="mt-2 text-xs opacity-75">
              🍺 Premium reward • Higher value • Maximum satisfaction
            </div>
          )}
        </div>
      )}

      {/* Time Context */}
      {beerContext && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
          <span>Current time: {beerContext.timeOfDay}</span>
          {isOptimalBeerTime && (
            <span className="text-amber-600 font-medium">
              ⭐ Optimal beer time
            </span>
          )}
        </div>
      )}

      {/* High urgency special effects */}
      {urgencyLevel === UrgencyLevel.HIGH && (
        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-red-400 to-orange-400 opacity-10 animate-pulse pointer-events-none" />
      )}

      {/* Beer reward special glow */}
      {isBeerReward && urgencyLevel === UrgencyLevel.HIGH && (
        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-amber-400 to-orange-400 opacity-20 animate-pulse pointer-events-none" />
      )}
    </div>
  );
}