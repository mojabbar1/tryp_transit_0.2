import { NextRequest, NextResponse } from 'next/server';
import { NudgeGenerator } from '@/lib/services/nudgeGenerator';
import { RewardManager } from '@/lib/services/rewardManager';
import { getBeerNudgeContext } from '@/lib/services/timeContext';
import { getDemoFallback } from '@/lib/demo/fallbacks';
import { logger } from '@/lib/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { userId, userName } = body;

    // Validate request
    if (!userId || !userName) {
      logger.apiEvent('transit_insights_validation_failed', { userId, error: 'Missing required fields' });
      return NextResponse.json(
        { error: 'userId and userName are required' },
        { status: 400 }
      );
    }

    logger.apiEvent('transit_insights_started', { userId, userName });

    const rewardManager = new RewardManager();
    const nudgeGenerator = new NudgeGenerator();

    // Initialize user rewards if they don't exist
    await rewardManager.initializeUserRewards(userId);

    // Get user progress
    const currentProgress = await rewardManager.getUserProgress(userId);

    // Get nearby partners (for now, get all partners as demo data)
    const nearbyPartners = await prisma.partner.findMany();

    // Get beer context for enhanced messaging
    const beerContext = getBeerNudgeContext();

    // Build nudge context
    const nudgeContext = {
      userId,
      userName,
      currentProgress,
      nearbyPartners,
      timeOfDay: `${new Date().getHours().toString().padStart(2,'0')}:${new Date().getMinutes().toString().padStart(2,'0')}`
    };

    // Generate personalized nudge
    let generatedNudge;
    try {
      generatedNudge = await nudgeGenerator.generatePersonalizedNudge(nudgeContext);
    } catch (error) {
      // Fallback to demo-specific messages
      logger.nudgeEvent('ai_failed', userId, { error: error instanceof Error ? error.message : String(error) });
      
      // Determine urgency based on best progress
      let urgencyLevel = 'low';
      let highestProgressPercent = 0;
      
      for (const progress of currentProgress) {
        if (!progress.isEarned) {
          const progressPercent = progress.completedTrips / progress.reward.requiredTrips;
          if (progressPercent > highestProgressPercent) {
            highestProgressPercent = progressPercent;
          }
        }
      }
      
      if (highestProgressPercent >= 0.8) urgencyLevel = 'high';
      else if (highestProgressPercent >= 0.5) urgencyLevel = 'medium';

      generatedNudge = {
        message: getDemoFallback(userId, 'beer_nudge', urgencyLevel),
        urgencyLevel,
        relevantReward: currentProgress.find(p => p.reward.rewardType === 'FREE_BEER')?.reward || null
      };
    }

    // Find beer-specific insights
    const beerProgress = currentProgress.find(p => p.reward.rewardType === 'FREE_BEER');
    const beerInsights = beerProgress ? {
      completedTrips: beerProgress.completedTrips,
      requiredTrips: beerProgress.reward.requiredTrips,
      progressPercent: Math.round((beerProgress.completedTrips / beerProgress.reward.requiredTrips) * 100),
      isEarned: beerProgress.isEarned,
      contextType: beerContext.contextType,
      isOptimalTime: beerContext.isOptimalBeerTime,
      redemptionCode: beerProgress.redemptionCode
    } : null;

    // Log beer nudge events
    if (beerProgress && !beerProgress.isEarned) {
      logger.beerRewardEvent('nudge_sent', userId, {
        urgencyLevel: generatedNudge.urgencyLevel,
        progressPercent: Math.round((beerProgress.completedTrips / beerProgress.reward.requiredTrips) * 100),
        contextType: beerContext.contextType
      });
    }

    const responseTime = Date.now() - startTime;
    logger.apiEvent('transit_insights_success', { 
      userId, 
      responseTime,
      urgencyLevel: generatedNudge.urgencyLevel,
      hasBeerProgress: !!beerProgress
    });

    return NextResponse.json({
      success: true,
      nudge: generatedNudge,
      beerContext: {
        contextType: beerContext.contextType,
        isOptimalTime: beerContext.isOptimalBeerTime,
        timeOfDay: beerContext.timeOfDay
      },
      beerInsights,
      userProgress: currentProgress,
      responseTime
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.apiEvent('transit_insights_error', { 
      error: error instanceof Error ? error.message : String(error),
      responseTime
    });
    
    console.error('Transit insights error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate transit insights',
        fallbackMessage: getDemoFallback('generic', 'api_error')
      },
      { status: 500 }
    );
  }
}