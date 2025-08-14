import { GeneratedNudge, NudgeContext, UrgencyLevel, RewardType } from '@/types/interfaces';
import { getBeerNudgeContext, getBeerContextMessage } from './timeContext';
import { logger } from '../logger';
import { aiClient } from '../aiClient';

interface CachedNudge {
  message: string;
  urgencyLevel: UrgencyLevel;
  relevantReward: any;
  timestamp: number;
}

export class NudgeGenerator {
  private cache = new Map<string, CachedNudge>();
  private readonly CACHE_TTL = parseInt(process.env.NUDGE_CACHE_TTL || '300000'); // 5 minutes default
  private readonly API_TIMEOUT = parseInt(process.env.API_TIMEOUT || '10000'); // 10 seconds default

  // Enhanced fallback templates with beer-specific messaging
  private fallbackTemplates = {
    high: [
      "You're so close, {userName}! Just {tripsRemaining} more trip to earn FREE BEER at {businessName}!",
      "Almost there, {userName}! Complete {tripsRemaining} more trip and claim your FREE BEER!",
      "You're so close, {userName}! Just {tripsRemaining} more trip to earn {rewardType} at {businessName}!",
      "Almost there, {userName}! Complete {tripsRemaining} more trip and claim your {rewardType}!",
    ],
    medium: [
      "Great progress, {userName}! You're {completedTrips} trips into earning FREE BEER at {businessName}.",
      "Keep it up, {userName}! {tripsRemaining} more trips until your FREE BEER reward.",
      "Great progress, {userName}! You're {completedTrips} trips into earning {rewardType} at {businessName}.",
      "Keep it up, {userName}! {tripsRemaining} more trips until your {rewardType} reward.",
    ],
    low: [
      "Start your journey toward FREE BEER at {businessName}, {userName}! Begin with your next trip.",
      "Earn rewards with every ride! Your next trip brings you closer to FREE BEER.",
      "Start your journey toward {rewardType} at {businessName}, {userName}! Begin with your next trip.",
      "Earn rewards with every ride! Your next trip brings you closer to {rewardType}.",
    ],
  };

  async generatePersonalizedNudge(context: NudgeContext): Promise<GeneratedNudge> {
    // Check cache first for performance
    const cacheKey = `${context.userId}-${context.timeOfDay}-${JSON.stringify(context.currentProgress.map(p => p.completedTrips))}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logger.nudgeEvent('cache_hit', context.userId, { cacheKey });
      return {
        message: cached.message,
        urgencyLevel: cached.urgencyLevel,
        relevantReward: cached.relevantReward
      };
    }

    // Try AI generation first
    try {
      const aiNudge = await this.generateWithAI(context);
      if (aiNudge) {
        // Cache successful AI generation
        this.cache.set(cacheKey, {
          message: aiNudge.message,
          urgencyLevel: aiNudge.urgencyLevel,
          relevantReward: aiNudge.relevantReward,
          timestamp: Date.now()
        });
        
        logger.nudgeEvent('generated', context.userId, { 
          urgencyLevel: aiNudge.urgencyLevel,
          rewardType: aiNudge.relevantReward?.rewardType 
        });
        
        return aiNudge;
      }
    } catch (error) {
      logger.nudgeEvent('ai_failed', context.userId, { error: error instanceof Error ? error.message : String(error) });
    }

    // Fall back to templates
    const fallbackNudge = this.generateFallbackNudge(context);
    logger.nudgeEvent('fallback_used', context.userId, { urgencyLevel: fallbackNudge.urgencyLevel });
    
    return fallbackNudge;
  }

  private async generateWithAI(context: NudgeContext): Promise<GeneratedNudge | null> {
    const prompt = this.buildEnhancedPrompt(context)
    const raw = await aiClient.generateTextJSON(prompt, { timeoutMs: this.API_TIMEOUT })
    return this.parseAIResponse(raw, context)
  }

  private buildEnhancedPrompt(context: NudgeContext): string {
    const { userName, currentProgress, nearbyPartners, timeOfDay } = context;
    
    // Find the most promising reward (highest progress percentage)
    let bestReward = null;
    let bestProgress = null;
    let highestProgressPercent = 0;

    for (const progress of currentProgress) {
      if (!progress.isEarned && progress.reward) {
        const progressPercent = progress.completedTrips / progress.reward.requiredTrips;
        if (progressPercent > highestProgressPercent) {
          highestProgressPercent = progressPercent;
          bestReward = progress.reward;
          bestProgress = progress;
        }
      }
    }

    // Get beer-specific context for enhanced messaging
    const beerContext = getBeerNudgeContext();
    const beerContextMessage = getBeerContextMessage(beerContext);

    return `You are an AI assistant that creates personalized, encouraging messages to motivate public transit users to complete trips and earn rewards.

Context:
- User name: ${userName}
- Time of day: ${timeOfDay}
- Beer context: ${beerContext.contextType} (${beerContextMessage})
- User's current reward progress: ${JSON.stringify(currentProgress.map(p => ({
  reward: p.reward?.title,
  progress: `${p.completedTrips}/${p.reward?.requiredTrips}`,
  isEarned: p.isEarned,
  rewardType: p.reward?.rewardType
})))}
- Nearby partner businesses: ${JSON.stringify(nearbyPartners.map(p => ({
  name: p.name,
  category: p.category
})))}

Create a personalized, encouraging message (1-2 sentences max) that:
1. Mentions the user by name
2. Highlights their best reward progress
3. Creates urgency if they're close to earning a reward
4. Mentions a specific nearby business when relevant
5. Is friendly and motivational

**Special Time-Contextual Instructions:**
- If the reward is FREE_BEER and beer context is optimal (${beerContext.isOptimalBeerTime}), emphasize: ${beerContextMessage}
- If the reward is FREE_COFFEE and time is morning (before 11 AM), frame as great way to start the day
- If the reward is FREE_APPETIZER and it's meal time, reference appropriate meal context

**Urgency Guidelines:**
- If user is 80%+ complete: create HIGH urgency with phrases like "You're so close!" or "Just X more trip!"
- If 50-79% complete: medium urgency with encouraging progress acknowledgment  
- Below 50%: low urgency with motivational framing

**CRITICAL: If the best reward is FREE_BEER, prioritize it and use "FREE BEER" explicitly in the message for maximum impact.**

Focus on the reward with the highest completion percentage. Return only the message text, nothing else.`;
  }

  private parseAIResponse(text: string, context: NudgeContext): GeneratedNudge {
    const message = text.trim();
    
    // Determine urgency based on user's best progress
    let urgencyLevel = UrgencyLevel.LOW;
    let relevantReward = null;
    let highestProgressPercent = 0;

    for (const progress of context.currentProgress) {
      if (!progress.isEarned && progress.reward) {
        const progressPercent = progress.completedTrips / progress.reward.requiredTrips;
        if (progressPercent > highestProgressPercent) {
          highestProgressPercent = progressPercent;
          relevantReward = progress.reward;
        }
      }
    }

    if (highestProgressPercent >= 0.8) {
      urgencyLevel = UrgencyLevel.HIGH;
    } else if (highestProgressPercent >= 0.5) {
      urgencyLevel = UrgencyLevel.MEDIUM;
    }

    return {
      message,
      urgencyLevel,
      relevantReward,
    };
  }

  private generateFallbackNudge(context: NudgeContext): GeneratedNudge {
    // Find best reward progress
    let bestReward = null;
    let bestProgress = null;
    let highestProgressPercent = 0;

    for (const progress of context.currentProgress) {
      if (!progress.isEarned && progress.reward) {
        const progressPercent = progress.completedTrips / progress.reward.requiredTrips;
        if (progressPercent > highestProgressPercent) {
          highestProgressPercent = progressPercent;
          bestReward = progress.reward;
          bestProgress = progress;
        }
      }
    }

    let urgencyLevel = UrgencyLevel.LOW;
    if (highestProgressPercent >= 0.8) urgencyLevel = UrgencyLevel.HIGH;
    else if (highestProgressPercent >= 0.5) urgencyLevel = UrgencyLevel.MEDIUM;

    // Select template based on urgency
    const templates = this.fallbackTemplates[urgencyLevel];
    const template = templates[Math.floor(Math.random() * templates.length)];

    // Replace placeholders
    let message = template;
    if (bestReward && bestProgress) {
      const tripsRemaining = bestReward.requiredTrips - bestProgress.completedTrips;
      const partner = context.nearbyPartners.find(p => p.id === bestReward.partnerId);
      
      // Special handling for beer rewards
      const rewardDisplay = bestReward.rewardType === RewardType.FREE_BEER ? 'FREE BEER' : bestReward.title;
      
      message = message
        .replace('{userName}', context.userName)
        .replace('{tripsRemaining}', tripsRemaining.toString())
        .replace('{completedTrips}', bestProgress.completedTrips.toString())
        .replace('{rewardType}', rewardDisplay)
        .replace('{businessName}', partner?.name || 'our partner location');
    } else {
      message = message.replace('{userName}', context.userName);
    }

    return {
      message,
      urgencyLevel,
      relevantReward: bestReward,
    };
  }

  // Clear cache method for testing/demo reset
  clearCache() {
    this.cache.clear();
    logger.nudgeEvent('cache_cleared', 'system');
  }
}