import { NextRequest, NextResponse } from 'next/server';
import { RewardManager } from '@/lib/services/rewardManager';
import { logger } from '@/lib/logger';
import { getCelebrationFallback } from '@/lib/demo/fallbacks';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { userId } = body;

    // Validate request
    if (!userId || typeof userId !== 'string') {
      logger.apiEvent('trip_completion_validation_failed', { userId, error: 'Invalid userId' });
      return NextResponse.json(
        { error: 'Valid userId is required' },
        { status: 400 }
      );
    }

    logger.apiEvent('trip_completion_started', { userId });

    // Initialize reward manager
    const rewardManager = new RewardManager();

    // Initialize user rewards if they don't exist
    await rewardManager.initializeUserRewards(userId);

    // Record trip completion and update progress
    const result = await rewardManager.recordTripCompletion(userId);

    // Log beer-specific events
    const beerRewards = result.newlyEarnedRewards.filter(r => r.reward?.rewardType === 'FREE_BEER');
    if (beerRewards.length > 0) {
      logger.beerRewardEvent('earned', userId, { 
        rewardCount: beerRewards.length,
        redemptionCodes: beerRewards.map(r => r.redemptionCode)
      });
    }

    // Track progress updates for beer rewards
    const beerProgress = result.updatedProgress.filter(p => p.reward?.rewardType === 'FREE_BEER');
    if (beerProgress.length > 0) {
      logger.beerRewardEvent('progress_updated', userId, {
        beerProgress: beerProgress.map(p => ({
          completedTrips: p.completedTrips,
          requiredTrips: p.reward?.requiredTrips,
          progressPercent: Math.round((p.completedTrips / p.reward?.requiredTrips) * 100)
        }))
      });
    }

    const responseTime = Date.now() - startTime;
    logger.apiEvent('trip_completion_success', { 
      userId, 
      responseTime,
      newRewardsCount: result.newlyEarnedRewards.length,
      beerRewardsEarned: beerRewards.length
    });

    return NextResponse.json({
      success: true,
      updatedProgress: result.updatedProgress,
      newlyEarnedRewards: result.newlyEarnedRewards,
      message: result.newlyEarnedRewards.length > 0 
        ? `Congratulations! You earned ${result.newlyEarnedRewards.length} new reward(s)!`
        : 'Trip recorded successfully!',
      celebrationMessage: result.newlyEarnedRewards.length > 0 
        ? getCelebrationFallback(result.newlyEarnedRewards[0]?.reward?.rewardType || 'generic')
        : null,
      responseTime
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.apiEvent('trip_completion_error', { 
      error: error instanceof Error ? error.message : String(error),
      responseTime
    });
    
    console.error('Trip completion error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to record trip completion',
        fallbackMessage: 'Your trip is being processed. Please try again if rewards don\'t update.'
      },
      { status: 500 }
    );
  }
}