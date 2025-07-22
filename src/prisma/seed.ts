import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with FREE BEER demo data...');

  // Create demo users
  const users = await Promise.all([
    prisma.userProfile.upsert({
      where: { email: 'alice@demo.com' },
      update: {},
      create: {
        name: 'Alice Johnson',
        email: 'alice@demo.com',
      },
    }),
    prisma.userProfile.upsert({
      where: { email: 'bob@demo.com' },
      update: {},
      create: {
        name: 'Bob Smith', 
        email: 'bob@demo.com',
      },
    }),
    prisma.userProfile.upsert({
      where: { email: 'carol@demo.com' },
      update: {},
      create: {
        name: 'Carol Williams',
        email: 'carol@demo.com',
      },
    }),
  ]);

  // Create partner businesses including BAR
  const partners = await Promise.all([
    // Coffee shops
    prisma.partner.upsert({
      where: { id: 'coffee-1' },
      update: {},
      create: {
        id: 'coffee-1',
        name: 'Downtown Brew',
        category: 'COFFEE',
        address: '123 Main St, Downtown',
        lat: 40.7589,
        lng: -73.9851,
        operatingHours: { open: '06:00', close: '18:00' },
      },
    }),
    // Restaurants
    prisma.partner.upsert({
      where: { id: 'restaurant-1' },
      update: {},
      create: {
        id: 'restaurant-1',
        name: 'Green Leaf Bistro',
        category: 'RESTAURANT', 
        address: '789 Park Ave, Uptown',
        lat: 40.7614,
        lng: -73.9776,
        operatingHours: { open: '11:00', close: '22:00' },
      },
    }),
    // FLAGSHIP: Bar partner for beer rewards
    prisma.partner.upsert({
      where: { id: 'bar-1' },
      update: {},
      create: {
        id: 'bar-1',
        name: 'The Local Taproom',
        category: 'BAR',
        address: '100 Ale St, Nightlife District',
        lat: 40.7599,
        lng: -73.9899,
        operatingHours: { open: '16:00', close: '23:59' }, // 4 PM - 11:59 PM
      },
    }),
    // eCredit partner
    prisma.partner.upsert({
      where: { id: 'ecredit-1' },
      update: {},
      create: {
        id: 'ecredit-1',
        name: 'Transit Rewards Network',
        category: 'ECREDIT',
        address: 'Virtual - Citywide',
        lat: 40.7589,
        lng: -73.9851,
        operatingHours: { open: '00:00', close: '23:59' },
      },
    }),
  ]);

  // Create rewards including FLAGSHIP beer reward
  await Promise.all([
    // $3 eCredit (3 trips, no time limit)
    prisma.reward.upsert({
      where: { id: 'reward-ecredit' },
      update: {},
      create: {
        id: 'reward-ecredit',
        partnerId: 'ecredit-1',
        title: '$3 Transit eCredit',
        description: 'Earn $3 credit toward future transit rides',
        requiredTrips: 3,
        timeWindow: null,
        rewardType: 'ECREDIT',
      },
    }),
    // Free Coffee (5 trips/week)
    prisma.reward.upsert({
      where: { id: 'reward-coffee' },
      update: {},
      create: {
        id: 'reward-coffee',
        partnerId: 'coffee-1',
        title: 'Free Coffee at Downtown Brew',
        description: 'Get a free coffee of your choice (up to $5 value)',
        requiredTrips: 5,
        timeWindow: 'week',
        rewardType: 'FREE_COFFEE',
      },
    }),
    // Free Appetizer (6 trips/2 weeks)
    prisma.reward.upsert({
      where: { id: 'reward-appetizer' },
      update: {},
      create: {
        id: 'reward-appetizer',
        partnerId: 'restaurant-1',
        title: 'Free Appetizer at Green Leaf Bistro',
        description: 'Choose any appetizer from our menu (up to $8 value)',
        requiredTrips: 6,
        timeWindow: '2weeks', 
        rewardType: 'FREE_APPETIZER',
      },
    }),
    // FLAGSHIP: Free Beer (7 trips/week) - HIGHEST VALUE REWARD
    prisma.reward.upsert({
      where: { id: 'reward-beer' },
      update: {},
      create: {
        id: 'reward-beer',
        partnerId: 'bar-1',
        title: 'Free Beer at The Local Taproom',
        description: 'Enjoy a pint of our craft beer on the house (up to $7 value)',
        requiredTrips: 7, // Higher threshold for premium reward
        timeWindow: 'week',
        rewardType: 'FREE_BEER',
      },
    }),
  ]);

  // Create strategic demo progress - ALICE IS THE BEER STAR
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // Alice: FLAGSHIP DEMO - Close to BEER reward (6/7 trips) - 86% complete
  await prisma.userRewardProgress.upsert({
    where: { userId_rewardId: { userId: users[0].id, rewardId: 'reward-beer' } },
    update: {},
    create: {
      userId: users[0].id,
      rewardId: 'reward-beer',
      completedTrips: 6, // 6/7 - PERFECT for high-impact demo
      lastTripDate: new Date(now.getTime() - 8 * 60 * 60 * 1000), // 8 hours ago
      resetDate: oneWeekAgo,
    },
  });

  // Alice: Secondary eCredit progress (2/3 trips)
  await prisma.userRewardProgress.upsert({
    where: { userId_rewardId: { userId: users[0].id, rewardId: 'reward-ecredit' } },
    update: {},
    create: {
      userId: users[0].id,
      rewardId: 'reward-ecredit',
      completedTrips: 2,
      lastTripDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    },
  });

  // Bob: Multiple active rewards including beer (5/7 trips)
  await Promise.all([
    prisma.userRewardProgress.upsert({
      where: { userId_rewardId: { userId: users[1].id, rewardId: 'reward-beer' } },
      update: {},
      create: {
        userId: users[1].id,
        rewardId: 'reward-beer',
        completedTrips: 5, // 5/7 - good progress for multi-tracking demo
        lastTripDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        resetDate: oneWeekAgo,
      },
    }),
    prisma.userRewardProgress.upsert({
      where: { userId_rewardId: { userId: users[1].id, rewardId: 'reward-ecredit' } },
      update: {},
      create: {
        userId: users[1].id,
        rewardId: 'reward-ecredit',
        completedTrips: 2,
        lastTripDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    }),
    // Bob: Already earned eCredit for redemption demo
    prisma.userRewardProgress.upsert({
      where: { userId_rewardId: { userId: users[1].id, rewardId: 'reward-coffee' } },
      update: {},
      create: {
        userId: users[1].id,
        rewardId: 'reward-coffee',
        completedTrips: 5,
        lastTripDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        isEarned: true,
        redemptionCode: 'CF3B7K9M',
        earnedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000),
        resetDate: oneWeekAgo,
      },
    }),
  ]);

  // Carol: Multiple earned rewards including beer for redemption demo
  await Promise.all([
    prisma.userRewardProgress.upsert({
      where: { userId_rewardId: { userId: users[2].id, rewardId: 'reward-beer' } },
      update: {},
      create: {
        userId: users[2].id,
        rewardId: 'reward-beer',
        completedTrips: 7,
        lastTripDate: new Date(now.getTime() - 36 * 60 * 60 * 1000),
        isEarned: true,
        redemptionCode: 'BR7X9K2M', // Beer redemption code
        earnedAt: new Date(now.getTime() - 36 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
        resetDate: oneWeekAgo,
      },
    }),
    prisma.userRewardProgress.upsert({
      where: { userId_rewardId: { userId: users[2].id, rewardId: 'reward-ecredit' } },
      update: {},
      create: {
        userId: users[2].id,
        rewardId: 'reward-ecredit',
        completedTrips: 3,
        lastTripDate: new Date(now.getTime() - 12 * 60 * 60 * 1000),
        isEarned: true,
        redemptionCode: 'EC7X9K2M',
        earnedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    }),
  ]);

  console.log('✅ Seed completed successfully!');
  console.log('🍺 Alice: 6/7 trips for FREE BEER (perfect for demo!)');
  console.log('🎯 Bob: Multiple active rewards including beer');
  console.log('🏆 Carol: Earned beer reward ready for redemption');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });