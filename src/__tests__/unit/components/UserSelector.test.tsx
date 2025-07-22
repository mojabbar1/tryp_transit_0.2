import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import UserSelector from '@/components/rewards/UserSelector'

describe('UserSelector', () => {
  const mockOnUserSelect = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render all demo users', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('Carol Williams')).toBeInTheDocument()
  })

  it('should highlight Alice as flagship user', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    expect(screen.getByText('🍺 FLAGSHIP')).toBeInTheDocument()
    expect(screen.getByText('Just 1 trip from FREE BEER!')).toBeInTheDocument()
  })

  it('should show correct beer progress for each user', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    // Alice: 6/7 (86%)
    expect(screen.getByText('6/7')).toBeInTheDocument()
    expect(screen.getByText('86%')).toBeInTheDocument()
    
    // Bob: 5/7 (71%)
    expect(screen.getByText('5/7')).toBeInTheDocument()
    expect(screen.getByText('71%')).toBeInTheDocument()
    
    // Carol: 7/7 (100%)
    expect(screen.getByText('7/7')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('should show selected state for current user', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
  })

  it('should call onUserSelect when user is clicked', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    const bobButton = screen.getByText('Bob Smith').closest('button')
    fireEvent.click(bobButton!)
    
    expect(mockOnUserSelect).toHaveBeenCalledWith('bob-demo')
  })

  it('should show demo instructions', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    expect(screen.getByText('🎯 Demo Scenarios:')).toBeInTheDocument()
    expect(screen.getByText(/Perfect "almost there" moment/)).toBeInTheDocument()
    expect(screen.getByText(/Multi-reward portfolio management/)).toBeInTheDocument()
    expect(screen.getByText(/Successful redemption experience/)).toBeInTheDocument()
  })

  it('should show correct special features for each user', () => {
    render(
      <UserSelector 
        selectedUserId="alice-demo" 
        onUserSelect={mockOnUserSelect} 
      />
    )
    
    expect(screen.getByText('Just 1 trip from FREE BEER!')).toBeInTheDocument()
    expect(screen.getByText('Multiple active rewards')).toBeInTheDocument()
    expect(screen.getByText('FREE BEER earned & ready!')).toBeInTheDocument()
  })
})