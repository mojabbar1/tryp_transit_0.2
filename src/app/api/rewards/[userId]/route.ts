import { NextRequest, NextResponse } from 'next/server';
import { RewardManager } from '@/lib/services/rewardManager';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const startTime = Date.now();
  
  try {
    const { userId } = params;

    // Validate request
    if (!userId || typeof userId !== 'string') {
      logger.apiEvent('rewards_status_validation_failed', { userId, error: 'Invalid userId' });
      return NextResponse.json(
        { error: 'Valid userId is required' },
        { status: 400 }
      );
    }

    logger.apiEvent('rewards_status_started', { userId });

    const rewardManager = new RewardManager();
    
    // Initialize user rewards if they don't exist
    await rewardManager.initializeUserRewards(userId);
    
    // Get user progress
    const progress = await rewardManager.getUserProgress(userId);

    // Separate and prioritize beer rewards
    const beerRewards = progress.filter(p => p.reward.rewardType === 'FREE_BEER');
    const otherRewards = progress.filter(p => p.reward.rewardType !== 'FREE_BEER');

    // Sort beer rewards by progress percentage (highest first)
    beerRewards.sort((a, b) => {
      const aPercent = a.completedTrips / a.reward.requiredTrips;
      const bPercent = b.completedTrips / b.reward.requiredTrips;
      return bPercent - aPercent;
    });

    // Sort other rewards by progress percentage
    otherRewards.sort((a, b) => {
      const aPercent = a.completedTrips / a.reward.requiredTrips;
      const bPercent = b.completedTrips / b.reward.requiredTrips;
      return bPercent - aPercent;
    });

    // Combine with beer rewards first (prioritized)
    const prioritizedProgress = [...beerRewards, ...otherRewards];

    // Calculate summary statistics
    const totalRewards = progress.length;
    const earnedRewards = progress.filter(p => p.isEarned).length;
    const beerProgress = beerRewards.length > 0 ? beerRewards[0] : null;
    const beerProgressPercent = beerProgress ? 
      Math.round((beerProgress.completedTrips / beerProgress.reward.requiredTrips) * 100) : 0;

    // Log beer-specific analytics
    if (beerProgress) {
      logger.beerRewardEvent('progress_updated', userId, {
        completedTrips: beerProgress.completedTrips,
        requiredTrips: beerProgress.reward.requiredTrips,
        progressPercent: beerProgressPercent,
        isEarned: beerProgress.isEarned
      });
    }

    const responseTime = Date.now() - startTime;
    logger.apiEvent('rewards_status_success', { 
      userId, 
      responseTime,
      totalRewards,
      earnedRewards,
      beerProgressPercent
    });

    return NextResponse.json({
      success: true,
      progress: prioritizedProgress,
      summary: {
        totalRewards,
        earnedRewards,
        activeRewards: totalRewards - earnedRewards,
        beerProgress: beerProgress ? {
          completedTrips: beerProgress.completedTrips,
          requiredTrips: beerProgress.reward.requiredTrips,
          progressPercent: beerProgressPercent,
          isEarned: beerProgress.isEarned,
          redemptionCode: beerProgress.redemptionCode
        } : null
      },
      responseTime
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.apiEvent('rewards_status_error', { 
      error: error instanceof Error ? error.message : String(error),
      responseTime
    });
    
    logger.error('rewards_status_error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { 
        error: 'Failed to fetch rewards status',
        fallbackMessage: 'Unable to load rewards. Please try again.'
      },
      { status: 500 }
    );
  }
}