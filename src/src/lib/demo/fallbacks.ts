export const DEMO_FALLBACKS = {
  // Alice - Beer flagship demo messages
  alice_beer_high_urgency: "🔥 Alice, you're just 1 trip away from your FREE BEER at The Local Taproom!",
  alice_beer_celebration: "🎉 Congratulations Alice! You've earned a FREE BEER! Your redemption code is: BR7X9K2M",
  
  // Bob - Multi-reward tracking messages  
  bob_beer_medium_urgency: "Hey Bob, great progress this week! Just 2 more trips for your free craft beer at The Local Taproom!",
  bob_multi_reward: "Bob, you're making great progress on multiple rewards! Focus on your beer reward - just 2 trips away!",
  
  // Carol - Redemption focused messages
  carol_redemption_beer: "Hi Carol! You've got a free beer waiting at The Local Taproom. Perfect for happy hour!",
  carol_multiple_earned: "Carol, you have multiple rewards ready! Don't forget your free beer at The Local Taproom.",
  
  // Generic fallbacks by urgency
  high_urgency_generic: "You're so close! Just 1 more trip to earn your reward!",
  medium_urgency_generic: "Great progress! Keep going to earn your reward!",
  low_urgency_generic: "Start earning rewards with your next trip!",
  
  // Error state messages
  api_error_message: "We're having trouble loading your personalized message, but your rewards are still tracking!",
  network_error_message: "Connection issue detected. Your trip progress is still being recorded!",
  
  // Celebration modal texts
  beer_earned_celebration: "🍺 Amazing! You've earned a FREE BEER! Time to celebrate your week of smart commuting!",
  coffee_earned_celebration: "☕ Great job! You've earned a FREE COFFEE! Perfect way to start your day!",
  generic_earned_celebration: "🎉 Congratulations! You've earned a new reward!",
};

export function getDemoFallback(userId: string, scenario: string, urgencyLevel?: string): string {
  // User-specific fallbacks
  if (userId.includes('alice') || userId === 'user_a') {
    if (scenario === 'beer_nudge') return DEMO_FALLBACKS.alice_beer_high_urgency;
    if (scenario === 'celebration') return DEMO_FALLBACKS.alice_beer_celebration;
  }
  
  if (userId.includes('bob') || userId === 'user_b') {
    if (scenario === 'beer_nudge') return DEMO_FALLBACKS.bob_beer_medium_urgency;
    if (scenario === 'multi_reward') return DEMO_FALLBACKS.bob_multi_reward;
  }
  
  if (userId.includes('carol') || userId === 'user_c') {
    if (scenario === 'redemption') return DEMO_FALLBACKS.carol_redemption_beer;
    if (scenario === 'multiple_earned') return DEMO_FALLBACKS.carol_multiple_earned;
  }
  
  // Generic fallbacks by urgency
  if (urgencyLevel === 'high') return DEMO_FALLBACKS.high_urgency_generic;
  if (urgencyLevel === 'medium') return DEMO_FALLBACKS.medium_urgency_generic;
  if (urgencyLevel === 'low') return DEMO_FALLBACKS.low_urgency_generic;
  
  // Error fallbacks
  if (scenario === 'api_error') return DEMO_FALLBACKS.api_error_message;
  if (scenario === 'network_error') return DEMO_FALLBACKS.network_error_message;
  
  return DEMO_FALLBACKS.high_urgency_generic; // Safe default
}

export function getCelebrationFallback(rewardType: string): string {
  switch (rewardType) {
    case 'FREE_BEER':
      return DEMO_FALLBACKS.beer_earned_celebration;
    case 'FREE_COFFEE':
      return DEMO_FALLBACKS.coffee_earned_celebration;
    default:
      return DEMO_FALLBACKS.generic_earned_celebration;
  }
}