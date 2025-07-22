import { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

const prisma = new PrismaClient();

interface TripCompletionResult {
  updatedProgress: any[];
  newlyEarnedRewards: any[];
}

export class RewardManager {
  async initializeUserRewards(userId: string) {
    try {
      // Get all available rewards
      const rewards = await prisma.reward.findMany({
        include: {
          partner: true
        }
      });

      // Check which rewards the user doesn't have progress for yet
      const existingProgress = await prisma.userRewardProgress.findMany({
        where: { userId }
      });

      const existingRewardIds = existingProgress.map(p => p.rewardId);
      const newRewards = rewards.filter(r => !existingRewardIds.includes(r.id));

      // Create progress entries for new rewards
      if (newRewards.length > 0) {
        await prisma.userRewardProgress.createMany({
          data: newRewards.map(reward => ({
            userId,
            rewardId: reward.id,
            completedTrips: 0,
            isEarned: false
          }))
        });

        logger.apiEvent('user_rewards_initialized', { 
          userId, 
          newRewardsCount: newRewards.length 
        });
      }
    } catch (error) {
      logger.apiEvent('user_rewards_init_error', { 
        userId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async recordTripCompletion(userId: string): Promise<TripCompletionResult> {
    try {
      // Record the trip completion
      await prisma.tripCompletion.create({
        data: {
          userId,
          completedAt: new Date()
        }
      });

      // Get current progress for all rewards
      const currentProgress = await prisma.userRewardProgress.findMany({
        where: { 
          userId,
          isEarned: false // Only update progress for unearned rewards
        },
        include: {
          reward: {
            include: {
              partner: true
            }
          }
        }
      });

      const updatedProgress = [];
      const newlyEarnedRewards = [];

      // Update progress for each reward
      for (const progress of currentProgress) {
        const newCompletedTrips = progress.completedTrips + 1;
        const isNowEarned = newCompletedTrips >= progress.reward.requiredTrips;

        let updateData: any = {
          completedTrips: newCompletedTrips,
          lastTripDate: new Date()
        };

        // If reward is now earned, generate redemption code
        if (isNowEarned) {
          updateData.isEarned = true;
          updateData.earnedAt = new Date();
          updateData.redemptionCode = this.generateRedemptionCode(progress.reward.rewardType);
          updateData.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        }

        const updatedProgressItem = await prisma.userRewardProgress.update({
          where: { id: progress.id },
          data: updateData,
          include: {
            reward: {
              include: {
                partner: true
              }
            }
          }
        });

        updatedProgress.push(updatedProgressItem);

        if (isNowEarned) {
          newlyEarnedRewards.push(updatedProgressItem);
        }
      }

      return {
        updatedProgress,
        newlyEarnedRewards
      };

    } catch (error) {
      logger.apiEvent('trip_completion_record_error', { 
        userId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  private generateRedemptionCode(rewardType: string): string {
    const prefix = rewardType === 'FREE_BEER' ? 'BR' : 
                   rewardType === 'FREE_COFFEE' ? 'CF' : 
                   rewardType === 'FREE_APPETIZER' ? 'AP' : 'EC';
    
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${randomPart}`;
  }

  async getUserProgress(userId: string) {
    return await prisma.userRewardProgress.findMany({
      where: { userId },
      include: {
        reward: {
          include: {
            partner: true
          }
        }
      },
      orderBy: [
        { isEarned: 'asc' }, // Unearned first
        { completedTrips: 'desc' } // Highest progress first
      ]
    });
  }
}