/**
 * @jest-environment node
 */
import { GET } from '@/app/api/rewards/[userId]/route'
import { NextRequest } from 'next/server'

// Mock the RewardManager
const mockRewardManager = {
  initializeUserRewards: jest.fn(),
  getUserProgress: jest.fn()
}

jest.mock('@/lib/services/rewardManager', () => ({
  RewardManager: jest.fn().mockImplementation(() => mockRewardManager)
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    apiEvent: jest.fn(),
    beerRewardEvent: jest.fn()
  }
}))

describe('/api/rewards/[userId] Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return user rewards with beer prioritization', async () => {
    mockRewardManager.getUserProgress.mockResolvedValue([
      {
        id: 'progress-1',
        completedTrips: 6,
        isEarned: false,
        reward: {
          rewardType: 'FREE_BEER',
          title: 'Free Beer at The Local Taproom',
          requiredTrips: 7
        }
      },
      {
        id: 'progress-2',
        completedTrips: 3,
        isEarned: false,
        reward: {
          rewardType: 'FREE_COFFEE',
          title: 'Free Coffee at Downtown Brew',
          requiredTrips: 5
        }
      }
    ])

    const request = new NextRequest('http://localhost:3000/api/rewards/alice-demo')
    const response = await GET(request, { params: { userId: 'alice-demo' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.progress).toHaveLength(2)
    
    // Beer reward should be first (prioritized)
    expect(data.progress[0].reward.rewardType).toBe('FREE_BEER')
    expect(data.progress[1].reward.rewardType).toBe('FREE_COFFEE')
    
    // Summary should include beer progress
    expect(data.summary.beerProgress).toEqual({
      completedTrips: 6,
      requiredTrips: 7,
      progressPercent: 86,
      isEarned: false
    })

    expect(mockRewardManager.initializeUserRewards).toHaveBeenCalledWith('alice-demo')
    expect(mockRewardManager.getUserProgress).toHaveBeenCalledWith('alice-demo')
  })

  it('should return 400 for invalid userId', async () => {
    const request = new NextRequest('http://localhost:3000/api/rewards/')
    const response = await GET(request, { params: { userId: '' } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Valid userId is required')
  })

  it('should handle earned beer rewards', async () => {
    mockRewardManager.getUserProgress.mockResolvedValue([
      {
        id: 'progress-1',
        completedTrips: 7,
        isEarned: true,
        redemptionCode: 'BR7X9K2M',
        reward: {
          rewardType: 'FREE_BEER',
          title: 'Free Beer at The Local Taproom',
          requiredTrips: 7
        }
      }
    ])

    const request = new NextRequest('http://localhost:3000/api/rewards/carol-demo')
    const response = await GET(request, { params: { userId: 'carol-demo' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.summary.beerProgress.isEarned).toBe(true)
    expect(data.summary.beerProgress.redemptionCode).toBe('BR7X9K2M')
    expect(data.summary.earnedRewards).toBe(1)
  })
})