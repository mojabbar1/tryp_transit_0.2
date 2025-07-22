'use client';

import React from 'react';
import { Beer, Coffee, UtensilsCrossed, CreditCard } from 'lucide-react';
import { RewardType } from '@/types/interfaces';

interface RewardProgressBarProps {
  rewardType: RewardType;
  title: string;
  description: string;
  completedTrips: number;
  requiredTrips: number;
  isEarned: boolean;
  redemptionCode?: string | null;
  partnerName: string;
}

const getRewardIcon = (rewardType: RewardType) => {
  switch (rewardType) {
    case RewardType.FREE_BEER:
      return <Beer className="w-6 h-6 text-amber-600" />;
    case RewardType.FREE_COFFEE:
      return <Coffee className="w-6 h-6 text-amber-800" />;
    case RewardType.FREE_APPETIZER:
      return <UtensilsCrossed className="w-6 h-6 text-green-600" />;
    case RewardType.ECREDIT:
      return <CreditCard className="w-6 h-6 text-blue-600" />;
    default:
      return <CreditCard className="w-6 h-6 text-gray-600" />;
  }
};

const getRewardColors = (rewardType: RewardType) => {
  switch (rewardType) {
    case RewardType.FREE_BEER:
      return {
        bg: 'bg-gradient-to-r from-amber-50 to-orange-50',
        border: 'border-amber-200',
        progress: 'bg-gradient-to-r from-amber-400 to-orange-500',
        text: 'text-amber-800',
        badge: 'bg-amber-100 text-amber-800'
      };
    case RewardType.FREE_COFFEE:
      return {
        bg: 'bg-gradient-to-r from-amber-50 to-yellow-50',
        border: 'border-amber-200',
        progress: 'bg-gradient-to-r from-amber-600 to-yellow-600',
        text: 'text-amber-900',
        badge: 'bg-amber-100 text-amber-900'
      };
    case RewardType.FREE_APPETIZER:
      return {
        bg: 'bg-gradient-to-r from-green-50 to-emerald-50',
        border: 'border-green-200',
        progress: 'bg-gradient-to-r from-green-500 to-emerald-500',
        text: 'text-green-800',
        badge: 'bg-green-100 text-green-800'
      };
    case RewardType.ECREDIT:
      return {
        bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
        border: 'border-blue-200',
        progress: 'bg-gradient-to-r from-blue-500 to-indigo-500',
        text: 'text-blue-800',
        badge: 'bg-blue-100 text-blue-800'
      };
    default:
      return {
        bg: 'bg-gray-50',
        border: 'border-gray-200',
        progress: 'bg-gray-500',
        text: 'text-gray-800',
        badge: 'bg-gray-100 text-gray-800'
      };
  }
};

export default function RewardProgressBar({
  rewardType,
  title,
  description,
  completedTrips,
  requiredTrips,
  isEarned,
  redemptionCode,
  partnerName
}: RewardProgressBarProps) {
  const progressPercent = Math.min((completedTrips / requiredTrips) * 100, 100);
  const colors = getRewardColors(rewardType);
  const icon = getRewardIcon(rewardType);
  
  // Special styling for beer rewards
  const isBeerReward = rewardType === RewardType.FREE_BEER;
  const isHighProgress = progressPercent >= 80;

  return (
    <div className={`
      relative p-4 rounded-lg border-2 transition-all duration-300
      ${colors.bg} ${colors.border}
      ${isBeerReward ? 'ring-2 ring-amber-300 ring-opacity-50' : ''}
      ${isEarned ? 'shadow-lg' : 'shadow-md'}
      hover:shadow-lg
    `}>
      {/* Beer reward special badge */}
      {isBeerReward && (
        <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full shadow-md">
          🍺 FLAGSHIP
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          {icon}
          <div>
            <h3 className={`font-semibold text-lg ${colors.text}`}>
              {title}
            </h3>
            <p className="text-sm text-gray-600">
              at {partnerName}
            </p>
          </div>
        </div>
        
        {isEarned ? (
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors.badge}`}>
            ✅ Earned!
          </span>
        ) : (
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors.badge}`}>
            {completedTrips}/{requiredTrips} trips
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">Progress</span>
          <span className={`text-sm font-medium ${colors.text}`}>
            {Math.round(progressPercent)}%
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-out ${colors.progress}`}
            style={{ width: `${progressPercent}%` }}
          >
            {/* Animated shimmer effect for high progress */}
            {isHighProgress && (
              <div className="h-full w-full bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse" />
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-700 mb-3">
        {description}
      </p>

      {/* Status Section */}
      {isEarned && redemptionCode ? (
        <div className={`p-3 rounded-md ${colors.badge} border border-current border-opacity-20`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">Redemption Code:</span>
            <code className="font-mono text-lg font-bold tracking-wider">
              {redemptionCode}
            </code>
          </div>
          {isBeerReward && (
            <p className="text-xs mt-1 opacity-75">
              🍺 Show this code at The Local Taproom to claim your free beer!
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            {requiredTrips - completedTrips} more trip{requiredTrips - completedTrips !== 1 ? 's' : ''} to earn
          </span>
          {isHighProgress && (
            <span className="text-orange-600 font-medium animate-pulse">
              🔥 Almost there!
            </span>
          )}
        </div>
      )}

      {/* Special beer messaging */}
      {isBeerReward && !isEarned && isHighProgress && (
        <div className="mt-3 p-2 bg-amber-100 border border-amber-300 rounded-md">
          <p className="text-xs text-amber-800 font-medium text-center">
            🍺 Just {requiredTrips - completedTrips} more trip{requiredTrips - completedTrips !== 1 ? 's' : ''} until your FREE BEER! 
          </p>
        </div>
      )}
    </div>
  );
}