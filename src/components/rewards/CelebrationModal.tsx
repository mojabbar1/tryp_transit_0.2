'use client';

import React, { useEffect, useState } from 'react';
import { X, Beer, Coffee, UtensilsCrossed, CreditCard, Copy, Check } from 'lucide-react';
import { RewardType } from '@/types/interfaces';

interface CelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reward: {
    rewardType: RewardType;
    title: string;
    description: string;
    redemptionCode: string;
    partnerName: string;
  } | null;
  userName: string;
}

const getRewardIcon = (rewardType: RewardType) => {
  switch (rewardType) {
    case RewardType.FREE_BEER:
      return <Beer className="w-16 h-16 text-amber-600" />;
    case RewardType.FREE_COFFEE:
      return <Coffee className="w-16 h-16 text-amber-800" />;
    case RewardType.FREE_APPETIZER:
      return <UtensilsCrossed className="w-16 h-16 text-green-600" />;
    case RewardType.ECREDIT:
      return <CreditCard className="w-16 h-16 text-blue-600" />;
    default:
      return <CreditCard className="w-16 h-16 text-gray-600" />;
  }
};

const getRewardColors = (rewardType: RewardType) => {
  switch (rewardType) {
    case RewardType.FREE_BEER:
      return {
        bg: 'bg-gradient-to-br from-amber-400 via-orange-400 to-amber-500',
        text: 'text-amber-900',
        accent: 'bg-amber-100 text-amber-800',
        button: 'bg-amber-600 hover:bg-amber-700'
      };
    case RewardType.FREE_COFFEE:
      return {
        bg: 'bg-gradient-to-br from-amber-600 via-yellow-500 to-amber-600',
        text: 'text-amber-900',
        accent: 'bg-amber-100 text-amber-900',
        button: 'bg-amber-700 hover:bg-amber-800'
      };
    case RewardType.FREE_APPETIZER:
      return {
        bg: 'bg-gradient-to-br from-green-400 via-emerald-400 to-green-500',
        text: 'text-green-900',
        accent: 'bg-green-100 text-green-800',
        button: 'bg-green-600 hover:bg-green-700'
      };
    case RewardType.ECREDIT:
      return {
        bg: 'bg-gradient-to-br from-blue-400 via-indigo-400 to-blue-500',
        text: 'text-blue-900',
        accent: 'bg-blue-100 text-blue-800',
        button: 'bg-blue-600 hover:bg-blue-700'
      };
    default:
      return {
        bg: 'bg-gradient-to-br from-gray-400 to-gray-500',
        text: 'text-gray-900',
        accent: 'bg-gray-100 text-gray-800',
        button: 'bg-gray-600 hover:bg-gray-700'
      };
  }
};

const getCelebrationMessage = (rewardType: RewardType, userName: string) => {
  switch (rewardType) {
    case RewardType.FREE_BEER:
      return {
        title: `🍺 Amazing, ${userName}!`,
        subtitle: "You've earned a FREE BEER!",
        message: "Time to celebrate your week of smart commuting! You've earned this premium reward through consistent transit use."
      };
    case RewardType.FREE_COFFEE:
      return {
        title: `☕ Great job, ${userName}!`,
        subtitle: "You've earned a FREE COFFEE!",
        message: "Perfect way to start your day! Your commitment to public transit has paid off."
      };
    case RewardType.FREE_APPETIZER:
      return {
        title: `🍽️ Excellent, ${userName}!`,
        subtitle: "You've earned a FREE APPETIZER!",
        message: "Enjoy a delicious appetizer on us! Your transit choices are making a difference."
      };
    case RewardType.ECREDIT:
      return {
        title: `💳 Congratulations, ${userName}!`,
        subtitle: "You've earned transit eCredit!",
        message: "Your reward credit is ready to use on future trips. Keep up the great work!"
      };
    default:
      return {
        title: `🎉 Congratulations, ${userName}!`,
        subtitle: "You've earned a new reward!",
        message: "Your commitment to public transit has earned you this reward!"
      };
  }
};

export default function CelebrationModal({
  isOpen,
  onClose,
  reward,
  userName
}: CelebrationModalProps) {
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen || !reward) return null;

  const colors = getRewardColors(reward.rewardType);
  const icon = getRewardIcon(reward.rewardType);
  const celebration = getCelebrationMessage(reward.rewardType, userName);
  const isBeerReward = reward.rewardType === RewardType.FREE_BEER;

  const copyRedemptionCode = async () => {
    try {
      await navigator.clipboard.writeText(reward.redemptionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Confetti effect */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className={`absolute w-2 h-2 ${colors.bg} animate-bounce`}
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      <div className={`
        relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden
        transform transition-all duration-300 scale-100
        ${isBeerReward ? 'ring-4 ring-amber-300 ring-opacity-50' : ''}
      `}>
        {/* Header with gradient background */}
        <div className={`${colors.bg} p-6 text-center relative`}>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white hover:text-gray-200 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Beer special badge */}
          {isBeerReward && (
            <div className="absolute top-4 left-4 bg-white bg-opacity-20 text-white text-xs font-bold px-2 py-1 rounded-full">
              🍺 FLAGSHIP
            </div>
          )}

          {/* Icon */}
          <div className="mb-4 flex justify-center">
            <div className="bg-white bg-opacity-20 rounded-full p-4">
              {icon}
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-white mb-2">
            {celebration.title}
          </h2>
          <p className="text-xl text-white font-semibold">
            {celebration.subtitle}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Message */}
          <p className="text-gray-700 text-center mb-6 leading-relaxed">
            {celebration.message}
          </p>

          {/* Reward Details */}
          <div className={`p-4 rounded-lg ${colors.accent} mb-6`}>
            <h3 className="font-semibold mb-2">Reward Details:</h3>
            <p className="font-medium">{reward.title}</p>
            <p className="text-sm opacity-75 mb-2">{reward.description}</p>
            <p className="text-sm">
              <strong>Location:</strong> {reward.partnerName}
            </p>
          </div>

          {/* Redemption Code */}
          <div className="bg-gray-100 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-gray-700">
                Redemption Code:
              </span>
              <button
                onClick={copyRedemptionCode}
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span className="text-sm">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span className="text-sm">Copy</span>
                  </>
                )}
              </button>
            </div>
            
            <div className="bg-white rounded-md p-3 border-2 border-dashed border-gray-300">
              <code className="text-2xl font-mono font-bold text-center block tracking-wider">
                {reward.redemptionCode}
              </code>
            </div>
          </div>

          {/* Beer-specific instructions */}
          {isBeerReward && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <h4 className="font-semibold text-amber-800 mb-2">
                🍺 How to Redeem Your FREE BEER:
              </h4>
              <ol className="text-sm text-amber-700 space-y-1">
                <li>1. Visit The Local Taproom</li>
                <li>2. Show this redemption code to staff</li>
                <li>3. Choose any craft beer (up to $7 value)</li>
                <li>4. Enjoy your well-deserved reward!</li>
              </ol>
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={onClose}
            className={`
              w-full py-3 px-6 rounded-lg font-semibold text-white transition-colors
              ${colors.button}
            `}
          >
            {isBeerReward ? '🍺 Time to Celebrate!' : 'Awesome, Thanks!'}
          </button>

          {/* Footer message */}
          <p className="text-center text-xs text-gray-500 mt-4">
            Keep using public transit to earn more rewards!
          </p>
        </div>
      </div>
    </div>
  );
}