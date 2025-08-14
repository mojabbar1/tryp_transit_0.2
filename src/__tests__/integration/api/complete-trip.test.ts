/**
 * @jest-environment node
 */
import { POST } from '@/app/api/complete-trip/route'
import { NextRequest } from 'next/server'

// Mock the RewardManager
const mockRewardManager = {
  initializeUserRewards: jest.fn(),
  recordTripCompletion: jest.fn()
}

jest.mock('@/lib/services/rewardManager', () => ({
  RewardManager: jest.fn().mockImplementation(() => mockRewardManager)
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    apiEvent: jest.fn(),
    beerRewardEvent: jest.fn(),
    error: jest.fn()
  }
}))

describe('/api/complete-trip Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should complete trip and return updated progress', async () => {
    mockRewardManager.recordTripCompletion.mockResolvedValue({
      updatedProgress: [
        {
          id: 'progress-1',
          completedTrips: 7,
          reward: {
            rewardType: 'FREE_BEER',
            title: 'Free Beer at The Local Taproom',
            requiredTrips: 7
          }
        }
      ],
      newlyEarnedRewards: [
        {
          id: 'progress-1',
          redemptionCode: 'BR7X9K2M',
          reward: {
            rewardType: 'FREE_BEER',
            title: 'Free Beer at The Local Taproom'
          }
        }
      ]
    })

    const request = new NextRequest('http://localhost:3000/api/complete-trip', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'alice-demo',
        userName: 'Alice Johnson'
      })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.newlyEarnedRewards).toHaveLength(1)
    expect(data.newlyEarnedRewards[0].redemptionCode).toBe('BR7X9K2M')
    expect(data.celebrationMessage).toContain('FREE BEER')
    expect(mockRewardManager.initializeUserRewards).toHaveBeenCalledWith('alice-demo')
    expect(mockRewardManager.recordTripCompletion).toHaveBeenCalledWith('alice-demo')
  })

  it('should return 400 for invalid request', async () => {
    const request = new NextRequest('http://localhost:3000/api/complete-trip', {
      method: 'POST',
      body: JSON.stringify({}) // Missing userId
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Valid userId is required')
  })

  it('should handle service errors gracefully', async () => {
    mockRewardManager.recordTripCompletion.mockRejectedValue(new Error('Database error'))

    const request = new NextRequest('http://localhost:3000/api/complete-trip', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'alice-demo',
        userName: 'Alice Johnson'
      })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to record trip completion')
    expect(data.fallbackMessage).toContain('try again')
  })
})