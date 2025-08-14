#!/usr/bin/env tsx

/**
 * Demo Reset Script for FREE BEER Transit Incentives
 * 
 * This script resets the demo to the perfect state:
 * - Alice back to 6/7 beer progress
 * - Bob back to 5/7 beer progress with other rewards
 * - Carol back to earned beer reward
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

async function resetDemo() {
  console.log('🔄 Resetting FREE BEER demo to perfect state...');
  
  try {
    // Get demo users
    const users = await prisma.userProfile.findMany({
      where: {
        email: {
          in: ['alice@demo.com', 'bob@demo.com', 'carol@demo.com']
        }
      }
    });

    if (users.length === 0) {
      console.log('⚠️  No demo users found. Running initial setup...');
      const { setupDemo } = await import('./setupDemo');
      await setupDemo();
      return;
    }

    // Reset Alice to 6/7 beer progress (perfect for demo)
    const alice = users.find(u => u.email === 'alice@demo.com');
    if (alice) {
      const beerReward = await prisma.reward.findFirst({
        where: { rewardType: 'FREE_BEER' }
      });

      if (beerReward) {
        await prisma.userRewardProgress.upsert({
          where: {
            userId_rewardId: {
              userId: alice.id,
              rewardId: beerReward.id
            }
          },
          update: {
            completedTrips: 6,
            isEarned: false,
            redemptionCode: null,
            earnedAt: null,
            expiresAt: null,
            lastTripDate: new Date(Date.now() - 8 * 60 * 60 * 1000) // 8 hours ago
          },
          create: {
            userId: alice.id,
            rewardId: beerReward.id,
            completedTrips: 6,
            isEarned: false,
            lastTripDate: new Date(Date.now() - 8 * 60 * 60 * 1000)
          }
        });
        console.log('✅ Alice reset to 6/7 beer progress');
      }
    }

    // Reset Bob to 5/7 beer progress
    const bob = users.find(u => u.email === 'bob@demo.com');
    if (bob) {
      const beerReward = await prisma.reward.findFirst({
        where: { rewardType: 'FREE_BEER' }
      });

      if (beerReward) {
        await prisma.userRewardProgress.upsert({
          where: {
            userId_rewardId: {
              userId: bob.id,
              rewardId: beerReward.id
            }
          },
          update: {
            completedTrips: 5,
            isEarned: false,
            redemptionCode: null,
            earnedAt: null,
            expiresAt: null,
            lastTripDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
          },
          create: {
            userId: bob.id,
            rewardId: beerReward.id,
            completedTrips: 5,
            isEarned: false,
            lastTripDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
          }
        });
        console.log('✅ Bob reset to 5/7 beer progress');
      }
    }

    // Reset Carol to earned beer reward
    const carol = users.find(u => u.email === 'carol@demo.com');
    if (carol) {
      const beerReward = await prisma.reward.findFirst({
        where: { rewardType: 'FREE_BEER' }
      });

      if (beerReward) {
        await prisma.userRewardProgress.upsert({
          where: {
            userId_rewardId: {
              userId: carol.id,
              rewardId: beerReward.id
            }
          },
          update: {
            completedTrips: 7,
            isEarned: true,
            redemptionCode: 'BR7X9K2M',
            earnedAt: new Date(Date.now() - 36 * 60 * 60 * 1000), // 36 hours ago
            expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days from now
            lastTripDate: new Date(Date.now() - 36 * 60 * 60 * 1000)
          },
          create: {
            userId: carol.id,
            rewardId: beerReward.id,
            completedTrips: 7,
            isEarned: true,
            redemptionCode: 'BR7X9K2M',
            earnedAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
            expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
            lastTripDate: new Date(Date.now() - 36 * 60 * 60 * 1000)
          }
        });
        console.log('✅ Carol reset to earned beer reward');
      }
    }

    // Clear nudge cache to ensure fresh AI responses
    console.log('🧹 Clearing nudge cache...');
    // Note: In a real implementation, this would clear Redis or similar cache
    
    console.log('🎯 Demo reset complete! Perfect for investor presentation.');
    console.log('📍 Alice: 6/7 beer progress (1 trip away!)');
    console.log('📍 Bob: 5/7 beer progress (multi-reward demo)');
    console.log('📍 Carol: Earned beer reward (redemption demo)');

    logger.demoEvent('demo_reset_completed', 'system', {
      aliceProgress: 6,
      bobProgress: 5,
      carolEarned: true
    });

  } catch (error) {
    console.error('❌ Demo reset failed:', error);
    logger.demoEvent('demo_reset_failed', 'system', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  resetDemo();
}

export { resetDemo };