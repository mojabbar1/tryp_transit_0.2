import React from 'react'
import { render, screen } from '@testing-library/react'
import RewardProgressBar from '@/components/rewards/RewardProgressBar'
import { RewardType } from '@/types/interfaces'

describe('RewardProgressBar', () => {
  const defaultProps = {
    rewardType: RewardType.FREE_BEER,
    title: 'Free Beer at The Local Taproom',
    description: 'Enjoy a pint of our craft beer on the house',
    completedTrips: 6,
    requiredTrips: 7,
    isEarned: false,
    redemptionCode: null,
    partnerName: 'The Local Taproom'
  }

  it('should render beer reward with flagship badge', () => {
    render(<RewardProgressBar {...defaultProps} />)
    
    expect(screen.getByText('🍺 FLAGSHIP')).toBeInTheDocument()
    expect(screen.getByText('Free Beer at The Local Taproom')).toBeInTheDocument()
    expect(screen.getByText('at The Local Taproom')).toBeInTheDocument()
  })

  it('should show correct progress percentage', () => {
    render(<RewardProgressBar {...defaultProps} />)
    
    expect(screen.getByText('86%')).toBeInTheDocument() // 6/7 = 86%
    expect(screen.getByText('6/7 trips')).toBeInTheDocument()
  })

  it('should show "Almost there!" for high progress', () => {
    render(<RewardProgressBar {...defaultProps} />)
    
    expect(screen.getByText('🔥 Almost there!')).toBeInTheDocument()
  })

  it('should show special beer messaging for high progress', () => {
    render(<RewardProgressBar {...defaultProps} />)
    
    expect(screen.getByText(/Just 1 more trip.*until your FREE BEER!/)).toBeInTheDocument()
  })

  it('should show earned state with redemption code', () => {
    const earnedProps = {
      ...defaultProps,
      isEarned: true,
      redemptionCode: 'BR7X9K2M'
    }
    
    render(<RewardProgressBar {...earnedProps} />)
    
    expect(screen.getByText('✅ Earned!')).toBeInTheDocument()
    expect(screen.getByText('BR7X9K2M')).toBeInTheDocument()
    expect(screen.getByText(/Show this code at The Local Taproom/)).toBeInTheDocument()
  })

  it('should render non-beer rewards without flagship badge', () => {
    const coffeeProps = {
      ...defaultProps,
      rewardType: RewardType.FREE_COFFEE,
      title: 'Free Coffee at Downtown Brew'
    }
    
    render(<RewardProgressBar {...coffeeProps} />)
    
    expect(screen.queryByText('🍺 FLAGSHIP')).not.toBeInTheDocument()
    expect(screen.getByText('Free Coffee at Downtown Brew')).toBeInTheDocument()
  })

  it('should show correct trips remaining', () => {
    const lowProgressProps = {
      ...defaultProps,
      completedTrips: 2,
      requiredTrips: 7
    }
    
    render(<RewardProgressBar {...lowProgressProps} />)
    
    expect(screen.getByText('5 more trips to earn')).toBeInTheDocument()
  })

  it('should handle singular trip remaining', () => {
    render(<RewardProgressBar {...defaultProps} />)
    
    expect(screen.getByText('1 more trip to earn')).toBeInTheDocument()
  })
})