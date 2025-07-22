import { getBeerNudgeContext, getBeerContextMessage } from '@/lib/services/timeContext'

describe('Time Context Service', () => {
  describe('getBeerNudgeContext', () => {
    it('should return TGIF_HAPPY_HOUR for Friday evening', () => {
      // Friday 5 PM
      const fridayEvening = new Date('2024-01-05T17:00:00')
      const context = getBeerNudgeContext(fridayEvening)
      
      expect(context.contextType).toBe('TGIF_HAPPY_HOUR')
      expect(context.isOptimalBeerTime).toBe(true)
      expect(context.dayOfWeek).toBe(5)
    })

    it('should return WEEKEND_RELAXATION for Saturday', () => {
      // Saturday 2 PM
      const saturday = new Date('2024-01-06T14:00:00')
      const context = getBeerNudgeContext(saturday)
      
      expect(context.contextType).toBe('WEEKEND_RELAXATION')
      expect(context.isOptimalBeerTime).toBe(true)
      expect(context.dayOfWeek).toBe(6)
    })

    it('should return WEEKDAY_UNWIND for weekday evening', () => {
      // Tuesday 6 PM
      const tuesdayEvening = new Date('2024-01-02T18:00:00')
      const context = getBeerNudgeContext(tuesdayEvening)
      
      expect(context.contextType).toBe('WEEKDAY_UNWIND')
      expect(context.isOptimalBeerTime).toBe(true)
      expect(context.dayOfWeek).toBe(2)
    })

    it('should return GENERAL_BEER_CONTEXT for non-optimal times', () => {
      // Tuesday 10 AM
      const tuesdayMorning = new Date('2024-01-02T10:00:00')
      const context = getBeerNudgeContext(tuesdayMorning)
      
      expect(context.contextType).toBe('GENERAL_BEER_CONTEXT')
      expect(context.isOptimalBeerTime).toBe(false)
      expect(context.dayOfWeek).toBe(2)
    })
  })

  describe('getBeerContextMessage', () => {
    it('should return correct message for TGIF_HAPPY_HOUR', () => {
      const message = getBeerContextMessage('TGIF_HAPPY_HOUR')
      expect(message).toBe('🍻 Perfect timing for Friday happy hour!')
    })

    it('should return correct message for WEEKEND_RELAXATION', () => {
      const message = getBeerContextMessage('WEEKEND_RELAXATION')
      expect(message).toBe('🍺 Great way to enjoy your weekend!')
    })

    it('should return correct message for WEEKDAY_UNWIND', () => {
      const message = getBeerContextMessage('WEEKDAY_UNWIND')
      expect(message).toBe('🍺 Perfect way to unwind after work!')
    })

    it('should return default message for unknown context', () => {
      const message = getBeerContextMessage('UNKNOWN' as any)
      expect(message).toBe('Enjoy a well-deserved beer!')
    })

    it('should work with context object', () => {
      const context = { contextType: 'TGIF_HAPPY_HOUR' as const }
      const message = getBeerContextMessage(context)
      expect(message).toBe('🍻 Perfect timing for Friday happy hour!')
    })
  })
})