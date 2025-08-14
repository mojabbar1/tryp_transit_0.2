interface LogEvent {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  category: 'demo' | 'beer_reward' | 'api' | 'nudge' | 'system';
  event: string;
  userId?: string;
  data?: any;
}

class Logger {
  private isDemo = process.env.DEMO_MODE_ENABLED === 'true';
  private logLevel = process.env.LOG_LEVEL || 'info';
  private enableBeerAnalytics = process.env.ENABLE_BEER_ANALYTICS === 'true';

  private log(event: LogEvent) {
    const logMessage = `[${event.category.toUpperCase()}] ${event.event}${event.userId ? ` - User: ${event.userId}` : ''}`;
    
    switch (event.level) {
      case 'error':
        console.error(logMessage, event.data);
        break;
      case 'warn':
        console.warn(logMessage, event.data);
        break;
      default:
        console.log(logMessage, event.data);
    }

    // In production: send to analytics service
    if (this.enableBeerAnalytics && event.category === 'beer_reward') {
      this.trackBeerAnalytics(event);
    }
  }

  demoEvent(event: string, userId: string, data?: any) {
    if (this.isDemo) {
      this.log({
        timestamp: new Date(),
        level: 'info',
        category: 'demo',
        event,
        userId,
        data
      });
    }
  }

  beerRewardEvent(event: 'earned' | 'redeemed' | 'nudge_sent' | 'progress_updated', userId: string, data?: any) {
    this.log({
      timestamp: new Date(),
      level: 'info', 
      category: 'beer_reward',
      event,
      userId,
      data
    });
  }

  apiEvent(event: string, data?: any) {
    this.log({
      timestamp: new Date(),
      level: 'info',
      category: 'api', 
      event,
      data
    });
  }

  error(event: string, data?: any) {
    this.log({
      timestamp: new Date(),
      level: 'error',
      category: 'system',
      event,
      data,
    });
  }

  nudgeEvent(event: 'generated' | 'fallback_used' | 'ai_failed' | 'cache_hit' | 'cache_cleared', userId: string, data?: any) {
    this.log({
      timestamp: new Date(),
      level: event === 'ai_failed' ? 'warn' : 'info',
      category: 'nudge',
      event,
      userId,
      data
    });
  }

  private trackBeerAnalytics(event: LogEvent) {
    // In production: send to analytics service like Mixpanel, Amplitude, etc.
    // For now, just enhanced logging
    console.log(`🍺 BEER ANALYTICS: ${event.event}`, {
      userId: event.userId,
      timestamp: event.timestamp,
      data: event.data
    });
  }
}

export const logger = new Logger();