#!/usr/bin/env tsx

/**
 * Demo Setup Script for FREE BEER Transit Incentives
 * 
 * This script sets up the demo environment with:
 * - Alice at 6/7 beer progress (flagship demo)
 * - Bob with multiple active rewards
 * - Carol with earned rewards ready for redemption
 */

import { logger } from '../lib/logger';
import { validateSecurity, runPreflight } from '../lib/config';
import { prisma } from '../lib/prisma';

async function setupDemo() {
  console.log('🍺 Setting up FREE BEER demo environment...');
  
  try {
    console.log('🔒 Validating security...')
    const security = validateSecurity()
    if (!security.secure) {
      console.error('❌ Security violations found:')
      security.violations.forEach(v => console.error(`   - ${v}`))
      process.exit(1)
    }
    if (security.recommendations.length > 0) {
      console.warn('⚠️  Security recommendations:')
      security.recommendations.forEach(r => console.warn(`   - ${r}`))
    }
    console.log('✅ Security validation passed\n')

    // Clear existing demo data
    console.log('🧹 Clearing existing demo data...');
    await prisma.userRewardProgress.deleteMany({
      where: {
        user: {
          email: {
            in: ['alice@demo.com', 'bob@demo.com', 'carol@demo.com']
          }
        }
      }
    });

    await prisma.tripCompletion.deleteMany({
      where: {
        user: {
          email: {
            in: ['alice@demo.com', 'bob@demo.com', 'carol@demo.com']
          }
        }
      }
    });

    // Run the seed script to set up fresh demo data
    console.log('🌱 Running database seed...');
    const { execSync } = require('child_process');
    execSync('npx prisma db seed', { stdio: 'inherit' });

    // Verify demo setup
    console.log('✅ Verifying demo setup...');
    
    const alice = await prisma.userProfile.findUnique({
      where: { email: 'alice@demo.com' },
      include: {
        rewardProgress: {
          include: {
            reward: {
              include: {
                partner: true
              }
            }
          }
        }
      }
    });

    if (alice) {
      const beerProgress = alice.rewardProgress.find(p => p.reward.rewardType === 'FREE_BEER');
      if (beerProgress) {
        console.log(`🍺 Alice beer progress: ${beerProgress.completedTrips}/${beerProgress.reward.requiredTrips} trips`);
        
        if (beerProgress.completedTrips === 6 && beerProgress.reward.requiredTrips === 7) {
          console.log('✅ Perfect! Alice is 1 trip away from FREE BEER (ideal for demo)');
        } else {
          console.log('⚠️  Alice beer progress is not optimal for demo');
        }
      }
    }

    // Log demo users status
    const users = await prisma.userProfile.findMany({
      where: {
        email: {
          in: ['alice@demo.com', 'bob@demo.com', 'carol@demo.com']
        }
      },
      include: {
        rewardProgress: {
          include: {
            reward: true
          }
        }
      }
    });

    users.forEach(user => {
      const beerReward = user.rewardProgress.find(p => p.reward.rewardType === 'FREE_BEER');
      if (beerReward) {
        const status = beerReward.isEarned ? 'EARNED' : `${beerReward.completedTrips}/${beerReward.reward.requiredTrips}`;
        console.log(`👤 ${user.name}: Beer progress ${status}`);
      }
    });

    // Run preflight so first API call is fast
    const preflight = runPreflight()
    if (!preflight.success) {
      console.error('❌ Preflight failed:', preflight.message)
      process.exit(1)
    }
    console.log('✅ Preflight checks passed')

    console.log('🎯 Demo environment ready for investor presentation!');
    console.log('📍 Navigate to /rewards to see the beer rewards system');
    
    logger.demoEvent('demo_setup_completed', 'system', {
      usersSetup: users.length,
      aliceBeerProgress: alice?.rewardProgress.find(p => p.reward.rewardType === 'FREE_BEER')?.completedTrips
    });

  } catch (error) {
    console.error('❌ Demo setup failed:', error);
    logger.demoEvent('demo_setup_failed', 'system', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  setupDemo();
}

export { setupDemo };