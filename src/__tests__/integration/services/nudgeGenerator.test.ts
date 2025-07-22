import { NudgeGenerator } from '@/lib/services/nudgeGenerator'
import { UrgencyLevel, RewardType } from '@/types/interfaces'

// Mock fetch for Gemini API
global.fetch = jest.fn()

describe('NudgeGenerator Integration', () => {
  let nudgeGenerator: NudgeGenerator
  
  beforeEach(() => {
    nudgeGenerator = new NudgeGenerator()
    jest.clearAllMocks()
    ;(fetch as jest.Mock).mockClear()
  })

  const mockContext = {
    userId: 'alice-demo',
    userName: 'Alice Johnson',
    currentProgress: [
      {
        id: 'progress-1',
        completedTrips: 6,
        isEarned: false,
        reward: {
          id: 'reward-1',
          rewardType: RewardType.FREE_BEER,
          title: 'Free Beer at The Local Taproom',
          requiredTrips: 7,
          partnerId: 'bar-1'
        }
      }
    ],
    nearbyPartners: [
      {
        id: 'bar-1',
        name: 'The Local Taproom',
        category: 'BAR',
        address: '100 Ale St',
        lat: 40.7599,
        lng: -73.9899,
        operatingHours: { open: '16:00', close: '23:59' }
      }
    ],
    timeOfDay: '17:00'
  }

  it('should generate AI nudge with beer prioritization', async () => {
    const mockGeminiResponse = {
      candidates: [{
        content: {
          parts: [{
            text: "Alice, you're just 1 trip away from your FREE BEER at The Local Taproom! Perfect timing for happy hour!"
          }]
        }
      }]
    }

    ;(fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeminiResponse
    })

    const result = await nudgeGenerator.generatePersonalizedNudge(mockContext)

    expect(result.message).toContain('FREE BEER')
    expect(result.message).toContain('Alice')
    expect(result.message).toContain('The Local Taproom')
    expect(result.urgencyLevel).toBe(UrgencyLevel.HIGH) // 6/7 = 86% = HIGH urgency
    expect(result.relevantReward?.rewardType).toBe(RewardType.FREE_BEER)

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('FREE BEER')
      })
    )
  })

  it('should fall back to templates when AI fails', async () => {
    ;(fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'))

    const result = await nudgeGenerator.generatePersonalizedNudge(mockContext)

    expect(result.message).toContain('Alice')
    expect(result.message).toContain('FREE BEER')
    expect(result.urgencyLevel).toBe(UrgencyLevel.HIGH)
    expect(result.relevantReward?.rewardType).toBe(RewardType.FREE_BEER)
  })

  it('should use cache for repeated requests', async () => {
    const mockGeminiResponse = {
      candidates: [{
        content: {
          parts: [{
            text: "Cached beer message for Alice!"
          }]
        }
      }]
    }

    ;(fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeminiResponse
    })

    // First call should hit API
    const result1 = await nudgeGenerator.generatePersonalizedNudge(mockContext)
    expect(fetch).toHaveBeenCalledTimes(1)

    // Second call should use cache
    const result2 = await nudgeGenerator.generatePersonalizedNudge(mockContext)
    expect(fetch).toHaveBeenCalledTimes(1) // Still 1, not 2
    expect(result2.message).toBe(result1.message)
  })

  it('should prioritize beer rewards over other rewards', async () => {
    const contextWithMultipleRewards = {
      ...mockContext,
      currentProgress: [
        {
          id: 'progress-1',
          completedTrips: 2,
          isEarned: false,
          reward: {
            id: 'reward-1',
            rewardType: RewardType.FREE_COFFEE,
            title: 'Free Coffee',
            requiredTrips: 5,
            partnerId: 'coffee-1'
          }
        },
        {
          id: 'progress-2',
          completedTrips: 6,
          isEarned: false,
          reward: {
            id: 'reward-2',
            rewardType: RewardType.FREE_BEER,
            title: 'Free Beer at The Local Taproom',
            requiredTrips: 7,
            partnerId: 'bar-1'
          }
        }
      ]
    }

    ;(fetch as jest.Mock).mockRejectedValueOnce(new Error('Use fallback'))

    const result = await nudgeGenerator.generatePersonalizedNudge(contextWithMultipleRewards)

    // Should prioritize beer (6/7 = 86%) over coffee (2/5 = 40%)
    expect(result.relevantReward?.rewardType).toBe(RewardType.FREE_BEER)
    expect(result.urgencyLevel).toBe(UrgencyLevel.HIGH)
  })

  it('should include beer context in AI prompt', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: "Beer context message"
            }]
          }
        }]
      })
    })

    await nudgeGenerator.generatePersonalizedNudge(mockContext)

    const fetchCall = (fetch as jest.Mock).mock.calls[0]
    const requestBody = JSON.parse(fetchCall[1].body)
    const prompt = requestBody.contents[0].parts[0].text

    expect(prompt).toContain('Beer context:')
    expect(prompt).toContain('FREE_BEER')
    expect(prompt).toContain('CRITICAL: If the best reward is FREE_BEER')
  })
})