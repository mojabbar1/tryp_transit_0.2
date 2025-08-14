export interface BeerNudgeContext {
  contextType: 'TGIF_HAPPY_HOUR' | 'WEEKEND_RELAXATION' | 'WEEKDAY_UNWIND' | 'LATE_NIGHT_SOCIAL' | 'GENERAL_BEER_CONTEXT';
  timeOfDay: string;
  dayOfWeek: number;
  isOptimalBeerTime: boolean;
}

export function getBeerNudgeContext(currentTime: Date = new Date()): BeerNudgeContext {
  const hour = currentTime.getHours();
  const dayOfWeek = currentTime.getDay(); // 0 = Sunday, 6 = Saturday
  
  let contextType: BeerNudgeContext['contextType'] = 'GENERAL_BEER_CONTEXT';
  let isOptimalBeerTime = false;

  // Friday evening (after 3 PM) - HIGHEST PRIORITY
  if (dayOfWeek === 5 && hour >= 15) {
    contextType = 'TGIF_HAPPY_HOUR';
    isOptimalBeerTime = true;
  }
  // Weekend anytime - HIGH PRIORITY  
  else if (dayOfWeek === 0 || dayOfWeek === 6) {
    contextType = 'WEEKEND_RELAXATION';
    isOptimalBeerTime = true;
  }
  // Weekday evening (after 4 PM) - MEDIUM PRIORITY
  else if (hour >= 16 && hour <= 22) {
    contextType = 'WEEKDAY_UNWIND';
    isOptimalBeerTime = true;
  }
  // Late night (10 PM - 1 AM) - MEDIUM PRIORITY
  else if (hour >= 22 || hour <= 1) {
    contextType = 'LATE_NIGHT_SOCIAL';
    isOptimalBeerTime = true;
  }
  
  const hhmm = `${currentTime.getHours().toString().padStart(2,'0')}:${currentTime.getMinutes().toString().padStart(2,'0')}`;
  return {
    contextType,
    timeOfDay: hhmm,
    dayOfWeek,
    isOptimalBeerTime
  };
}

export function getBeerContextMessage(context: BeerNudgeContext | string): string {
  const contextType = typeof context === 'string' ? context : context.contextType;
  
  switch (contextType) {
    case 'TGIF_HAPPY_HOUR':
      return '🍻 Perfect timing for Friday happy hour!';
    case 'WEEKEND_RELAXATION': 
      return '🍺 Great way to enjoy your weekend!';
    case 'WEEKDAY_UNWIND':
      return '🍺 Perfect way to unwind after work!';
    case 'LATE_NIGHT_SOCIAL':
      return '🍺 Great for a nightcap with friends!';
    default:
      return 'Enjoy a well-deserved beer!';
  }
}