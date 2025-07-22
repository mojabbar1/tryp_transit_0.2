// Mock Prisma first
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    reward: {
      findMany: jest.fn()
    },
    userRewardProgress: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn()
    },
    tripCompletion: {
      create: jest.fn()
    }
  }
  
  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrisma)
  }
})

jest.mock('@/lib/logger', () => ({
  logger: {
    apiEvent: jest.fn()
  }
}))

import { RewardManager } from '@/lib/services/rewardManager'
import { PrismaClient } from '@prisma/client'

const mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>

describe('RewardManager', () => {
  let rewardManager: RewardManager
  
  beforeEach(() => {
    rewardManager = new RewardManager()
    jest.clearAllMocks()
  })

  describe('initializeUserRewards', () => {
    it('should create progress entries for new rewards', async () => {
      const userId = 'test-user-id'
      const mockRewards = [
        { id: 'reward-1', rewardType: 'FREE_BEER', requiredTrips: 7, partner: {} },
        { id: 'reward-2', rewardType: 'FREE_COFFEE', requiredTrips: 5, partner: {} }
      ]
      const mockExistingProgress = []

      mockPrisma.reward.findMany.mockResolvedValue(mockRewards)
      mockPrisma.userRewardProgress.findMany.mockResolvedValue(mockExistingProgress)
      mockPrisma.userRewardProgress.createMany.mockResolvedValue({ count: 2 })

      await rewardManager.initializeUserRewards(userId)

      expect(mockPrisma.userRewardProgress.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId,
            rewardId: 'reward-1',
            completedTrips: 0,
            isEarned: false
          },
          {
            userId,
            rewardId: 'reward-2',
            completedTrips: 0,
            isEarned: false
          }
        ]
      })
    })

    it('should not create progress for existing rewards', async () => {
      const userId = 'test-user-id'
      const mockRewards = [
        { id: 'reward-1', rewardType: 'FREE_BEER', requiredTrips: 7, partner: {} }
      ]
      const mockExistingProgress = [
        { rewardId: 'reward-1' }
      ]

      mockPrisma.reward.findMany.mockResolvedValue(mockRewards)
      mockPrisma.userRewardProgress.findMany.mockResolvedValue(mockExistingProgress)

      await rewardManager.initializeUserRewards(userId)

      expect(mockPrisma.userRewardProgress.createMany).not.toHaveBeenCalled()
    })
  })

  describe('recordTripCompletion', () => {
    it('should record trip and update progress', async () => {
      const userId = 'test-user-id'
      const mockProgress = [{
        id: 'progress-1',
        completedTrips: 5,
        reward: { requiredTrips: 7, rewardType: 'FREE_BEER', partner: {} }
      }]

      mockPrisma.tripCompletion.create.mockResolvedValue({})
      mockPrisma.userRewardProgress.findMany.mockResolvedValue(mockProgress)
      mockPrisma.userRewardProgress.update.mockResolvedValue({
        ...mockProgress[0],
        completedTrips: 6
      })

      const result = await rewardManager.recordTripCompletion(userId)

      expect(mockPrisma.tripCompletion.create).toHaveBeenCalledWith({
        data: {
          userId,
          completedAt: expect.any(Date)
        }
      })

      expect(mockPrisma.userRewardProgress.update).toHaveBeenCalledWith({
        where: { id: 'progress-1' },
        data: {
          completedTrips: 6,
          lastTripDate: expect.any(Date)
        },
        include: expect.any(Object)
      })
    })

    it('should mark reward as earned when threshold reached', async () => {
      const userId = 'test-user-id'
      const mockProgress = [{
        id: 'progress-1',
        completedTrips: 6,
        reward: { requiredTrips: 7, rewardType: 'FREE_BEER', partner: {} }
      }]

      mockPrisma.tripCompletion.create.mockResolvedValue({})
      mockPrisma.userRewardProgress.findMany.mockResolvedValue(mockProgress)
      mockPrisma.userRewardProgress.update.mockResolvedValue({
        ...mockProgress[0],
        completedTrips: 7,
        isEarned: true,
        redemptionCode: 'BR123456'
      })

      const result = await rewardManager.recordTripCompletion(userId)

      expect(mockPrisma.userRewardProgress.update).toHaveBeenCalledWith({
        where: { id: 'progress-1' },
        data: {
          completedTrips: 7,
          lastTripDate: expect.any(Date),
          isEarned: true,
          earnedAt: expect.any(Date),
          redemptionCode: expect.stringMatching(/^BR[A-Z0-9]{6}$/),
          expiresAt: expect.any(Date)
        },
        include: expect.any(Object)
      })

      expect(result.newlyEarnedRewards).toHaveLength(1)
    })
  })

  describe('generateRedemptionCode', () => {
    it('should generate correct prefix for beer rewards', () => {
      const rewardManager = new RewardManager()
      // Access private method through any cast for testing
      const code = (rewardManager as any).generateRedemptionCode('FREE_BEER')
      expect(code).toMatch(/^BR[A-Z0-9]{6}$/)
    })

    it('should generate correct prefix for coffee rewards', () => {
      const rewardManager = new RewardManager()
      const code = (rewardManager as any).generateRedemptionCode('FREE_COFFEE')
      expect(code).toMatch(/^CF[A-Z0-9]{6}$/)
    })
  })
})