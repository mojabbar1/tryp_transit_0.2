'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import RewardProgressBar from '@/components/rewards/RewardProgressBar';
import NudgeMessageCard from '@/components/rewards/NudgeMessageCard';
import UserSelector from '@/components/rewards/UserSelector';
import TripCompletionButton from '@/components/rewards/TripCompletionButton';
import CelebrationModal from '@/components/rewards/CelebrationModal';
import { RewardType, UrgencyLevel } from '@/types/interfaces';

interface UserProgress {
  id: string;
  userId: string;
  rewardId: string;
  completedTrips: number;
  lastTripDate: Date | null;
  isEarned: boolean;
  redemptionCode: string | null;
  earnedAt: Date | null;
  expiresAt: Date | null;
  resetDate: Date | null;
  reward: {
    id: string;
    partnerId: string;
    title: string;
    description: string;
    requiredTrips: number;
    timeWindow: string | null;
    rewardType: RewardType;
    partner: {
      id: string;
      name: string;
      category: string;
      address: string;
    };
  };
}

interface GeneratedNudge {
  message: string;
  urgencyLevel: UrgencyLevel;
  relevantReward: any;
}

interface BeerContext {
  contextType: string;
  isOptimalTime: boolean;
  timeOfDay: string;
}

export default function RewardsPage() {
  const [selectedUserId, setSelectedUserId] = useState('alice-demo');
  const [userProgress, setUserProgress] = useState<UserProgress[]>([]);
  const [nudgeData, setNudgeData] = useState<GeneratedNudge | null>(null);
  const [beerContext, setBeerContext] = useState<BeerContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [celebrationReward, setCelebrationReward] = useState<any>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  // Demo user mapping
  const getUserInfo = (userId: string) => {
    switch (userId) {
      case 'alice-demo':
        return { name: 'Alice Johnson', email: 'alice@demo.com' };
      case 'bob-demo':
        return { name: 'Bob Smith', email: 'bob@demo.com' };
      case 'carol-demo':
        return { name: 'Carol Williams', email: 'carol@demo.com' };
      default:
        return { name: 'Demo User', email: 'demo@example.com' };
    }
  };

  // Load user progress and nudge data
  const loadUserData = async (userId: string) => {
    setIsLoading(true);
    try {
      // Load rewards status
      const rewardsResponse = await fetch(`/api/rewards/${userId}`);
      if (rewardsResponse.ok) {
        const rewardsData = await rewardsResponse.json();
        setUserProgress(rewardsData.progress || []);
      }

      // Load transit insights (nudge)
      const userInfo = getUserInfo(userId);
      const insightsResponse = await fetch('/api/transit-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          userName: userInfo.name
        }),
      });

      if (insightsResponse.ok) {
        const insightsData = await insightsResponse.json();
        setNudgeData(insightsData.nudge);
        setBeerContext(insightsData.beerContext);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      // Use fallback data for demo
      setUserProgress([]);
      setNudgeData({
        message: `Hey ${getUserInfo(userId).name}! Complete your next trip to earn rewards!`,
        urgencyLevel: UrgencyLevel.MEDIUM,
        relevantReward: null
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle user selection change
  const handleUserSelect = (userId: string) => {
    setSelectedUserId(userId);
    loadUserData(userId);
  };

  // Handle trip completion
  const handleTripCompleted = (result: any) => {
    if (result.success && result.newlyEarnedRewards?.length > 0) {
      const newReward = result.newlyEarnedRewards[0];
      setCelebrationReward({
        rewardType: newReward.reward.rewardType,
        title: newReward.reward.title,
        description: newReward.reward.description,
        redemptionCode: newReward.redemptionCode,
        partnerName: newReward.reward.partner.name
      });
      setShowCelebration(true);
    }

    // Refresh user data
    loadUserData(selectedUserId);
  };

  // Get beer progress for the selected user
  const getBeerProgress = () => {
    const beerReward = userProgress.find(p => p.reward.rewardType === RewardType.FREE_BEER);
    if (!beerReward) return null;

    return {
      completed: beerReward.completedTrips,
      required: beerReward.reward.requiredTrips,
      percentage: Math.round((beerReward.completedTrips / beerReward.reward.requiredTrips) * 100)
    };
  };

  // Load initial data
  useEffect(() => {
    loadUserData(selectedUserId);
  }, []);

  const userInfo = getUserInfo(selectedUserId);
  const beerProgress = getBeerProgress();

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🍺 FREE BEER Transit Rewards
          </h1>
          <p className="text-gray-600 mb-4">
            Earn premium rewards by using public transit • Flagship Feature Demo
          </p>
          <div className="flex justify-center space-x-4">
            <a
              href="/"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              🚌 Back to Transit Insights
            </a>
            <a
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm"
            >
              📊 Investor Dashboard
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: User Selection & Trip Completion */}
          <div className="space-y-6">
            <UserSelector
              selectedUserId={selectedUserId}
              onUserSelect={handleUserSelect}
            />
            
            <TripCompletionButton
              userId={selectedUserId}
              userName={userInfo.name}
              onTripCompleted={handleTripCompleted}
              disabled={isLoading}
              beerProgress={beerProgress}
            />
          </div>

          {/* Middle Column: Nudge Message & Beer Context */}
          <div className="space-y-6">
            {nudgeData && (
              <NudgeMessageCard
                message={nudgeData.message}
                urgencyLevel={nudgeData.urgencyLevel}
                relevantReward={nudgeData.relevantReward}
                beerContext={beerContext}
              />
            )}

            {/* Beer Context Information */}
            {beerContext && (
              <Card className="bg-amber-50 border-amber-200">
                <CardHeader>
                  <CardTitle className="text-amber-800 flex items-center">
                    🍺 Beer Context Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-amber-700">Context Type:</span>
                      <span className="font-medium text-amber-800">
                        {beerContext.contextType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-700">Current Time:</span>
                      <span className="font-medium text-amber-800">
                        {beerContext.timeOfDay}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-700">Optimal Beer Time:</span>
                      <span className={`font-medium ${beerContext.isOptimalTime ? 'text-green-600' : 'text-gray-600'}`}>
                        {beerContext.isOptimalTime ? '✅ Yes' : '❌ No'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column: Reward Progress */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-800">
                  🏆 Your Rewards Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading rewards...</p>
                  </div>
                ) : userProgress.length > 0 ? (
                  <div className="space-y-4">
                    {userProgress.map((progress) => (
                      <RewardProgressBar
                        key={progress.id}
                        rewardType={progress.reward.rewardType}
                        title={progress.reward.title}
                        description={progress.reward.description}
                        completedTrips={progress.completedTrips}
                        requiredTrips={progress.reward.requiredTrips}
                        isEarned={progress.isEarned}
                        redemptionCode={progress.redemptionCode}
                        partnerName={progress.reward.partner.name}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-600 mb-4">No rewards data available</p>
                    <p className="text-sm text-gray-500">
                      This demo requires a configured database to show live progress
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Demo Instructions */}
        <Card className="mt-8 bg-gray-50 border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-800">
              🎯 Demo Instructions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Alice (Flagship Demo)</h4>
                <ul className="text-gray-600 space-y-1">
                  <li>• 6/7 trips toward FREE BEER</li>
                  <li>• Perfect "almost there" moment</li>
                  <li>• High urgency messaging</li>
                  <li>• Ideal for investor presentations</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Bob (Multi-Reward)</h4>
                <ul className="text-gray-600 space-y-1">
                  <li>• 5/7 beer progress</li>
                  <li>• Multiple active rewards</li>
                  <li>• Portfolio management demo</li>
                  <li>• Shows reward diversity</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Carol (Redemption)</h4>
                <ul className="text-gray-600 space-y-1">
                  <li>• Earned FREE BEER reward</li>
                  <li>• Redemption code available</li>
                  <li>• Success state demonstration</li>
                  <li>• Shows reward fulfillment</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Celebration Modal */}
        <CelebrationModal
          isOpen={showCelebration}
          onClose={() => setShowCelebration(false)}
          reward={celebrationReward}
          userName={userInfo.name}
        />
      </div>
    </div>
  );
}