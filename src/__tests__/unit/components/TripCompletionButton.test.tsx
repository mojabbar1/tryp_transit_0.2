import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TripCompletionButton from '@/components/rewards/TripCompletionButton'

// Mock fetch
global.fetch = jest.fn()

describe('TripCompletionButton', () => {
  const mockOnTripCompleted = jest.fn()
  
  const defaultProps = {
    userId: 'alice-demo',
    userName: 'Alice Johnson',
    onTripCompleted: mockOnTripCompleted,
    disabled: false,
    beerProgress: {
      completed: 6,
      required: 7,
      percentage: 86
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(fetch as jest.Mock).mockClear()
  })

  it('should render beer progress indicator', () => {
    render(<TripCompletionButton {...defaultProps} />)
    
    expect(screen.getByText('FREE BEER Progress')).toBeInTheDocument()
    expect(screen.getByText('6/7')).toBeInTheDocument()
    expect(screen.getByText('🍺 Just 1 more trip for your FREE BEER!')).toBeInTheDocument()
  })

  it('should show special beer button text when almost complete', () => {
    render(<TripCompletionButton {...defaultProps} />)
    
    expect(screen.getByText('🍺 Complete Trip → Earn FREE BEER!')).toBeInTheDocument()
  })

  it('should show special beer messaging when almost complete', () => {
    render(<TripCompletionButton {...defaultProps} />)
    
    expect(screen.getByText('🍺 You\'re about to earn your FREE BEER!')).toBeInTheDocument()
    expect(screen.getByText(/Complete this trip and celebrate/)).toBeInTheDocument()
  })

  it('should handle successful trip completion', async () => {
    const mockResponse = {
      success: true,
      newlyEarnedRewards: [],
      updatedProgress: []
    }
    
    ;(fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    })

    render(<TripCompletionButton {...defaultProps} />)
    
    const button = screen.getByText('🍺 Complete Trip → Earn FREE BEER!')
    fireEvent.click(button)

    expect(screen.getByText('Recording Trip...')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockOnTripCompleted).toHaveBeenCalledWith(mockResponse)
    })

    expect(fetch).toHaveBeenCalledWith('/api/complete-trip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'alice-demo',
        userName: 'Alice Johnson'
      }),
    })
  })

  it('should handle API errors gracefully', async () => {
    ;(fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'))

    render(<TripCompletionButton {...defaultProps} />)
    
    const button = screen.getByText('🍺 Complete Trip → Earn FREE BEER!')
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockOnTripCompleted).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to complete trip, but progress is still tracked',
        fallbackMessage: 'Your trip has been recorded. Rewards will update shortly.'
      })
    })
  })

  it('should show demo instructions', () => {
    render(<TripCompletionButton {...defaultProps} />)
    
    expect(screen.getByText('🎯 Demo Instructions:')).toBeInTheDocument()
    expect(screen.getByText(/Click to simulate completing a transit trip/)).toBeInTheDocument()
  })

  it('should be disabled when disabled prop is true', () => {
    render(<TripCompletionButton {...defaultProps} disabled={true} />)
    
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should show different text for non-beer progress', () => {
    const propsWithoutBeer = {
      ...defaultProps,
      beerProgress: undefined
    }
    
    render(<TripCompletionButton {...propsWithoutBeer} />)
    
    expect(screen.getByText('Complete Transit Trip')).toBeInTheDocument()
  })

  it('should show completion state after successful trip', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    render(<TripCompletionButton {...defaultProps} />)
    
    const button = screen.getByText('🍺 Complete Trip → Earn FREE BEER!')
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Trip Completed!')).toBeInTheDocument()
    })

    expect(screen.getByText(/Trip completed at/)).toBeInTheDocument()
  })
})