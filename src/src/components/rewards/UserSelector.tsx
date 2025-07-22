'use client';

import React from 'react';
import { User, Beer, Coffee, Trophy } from 'lucide-react';

interface DemoUser {
  id: string;
  name: string;
  email: string;
  description: string;
  beerProgress: {
    completed: number;
    required: number;
    percentage: number;
  };
  specialFeature: string;
  icon: React.ReactNode;
}

interface UserSelectorProps {
  selectedUserId: string;
  onUserSelect: (userId: string) => void;
}

const DEMO_USERS: DemoUser[] = [
  {
    id: 'alice-demo',
    name: 'Alice Johnson',
    email: 'alice@demo.com',
    description: 'Perfect for flagship beer demo',
    beerProgress: {
      completed: 6,
      required: 7,
      percentage: 86
    },
    specialFeature: 'Just 1 trip from FREE BEER!',
    icon: <Beer className="w-5 h-5 text-amber-600" />
  },
  {
    id: 'bob-demo',
    name: 'Bob Smith',
    email: 'bob@demo.com',
    description: 'Multi-reward tracking demo',
    beerProgress: {
      completed: 5,
      required: 7,
      percentage: 71
    },
    specialFeature: 'Multiple active rewards',
    icon: <Coffee className="w-5 h-5 text-blue-600" />
  },
  {
    id: 'carol-demo',
    name: 'Carol Williams',
    email: 'carol@demo.com',
    description: 'Redemption experience demo',
    beerProgress: {
      completed: 7,
      required: 7,
      percentage: 100
    },
    specialFeature: 'FREE BEER earned & ready!',
    icon: <Trophy className="w-5 h-5 text-green-600" />
  }
];

export default function UserSelector({ selectedUserId, onUserSelect }: UserSelectorProps) {
  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4">
      <div className="flex items-center space-x-2 mb-4">
        <User className="w-5 h-5 text-gray-600" />
        <h3 className="text-lg font-semibold text-gray-800">
          Demo User Selection
        </h3>
      </div>

      <div className="space-y-3">
        {DEMO_USERS.map((user) => {
          const isSelected = selectedUserId === user.id;
          const isAlice = user.id === 'alice-demo';
          const isCarol = user.id === 'carol-demo';
          
          return (
            <button
              key={user.id}
              onClick={() => onUserSelect(user.id)}
              className={`
                w-full p-3 rounded-lg border-2 text-left transition-all duration-200
                ${isSelected 
                  ? 'border-blue-500 bg-blue-50 shadow-md' 
                  : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
                }
                ${isAlice ? 'ring-2 ring-amber-300 ring-opacity-50' : ''}
              `}
            >
              {/* Alice special flagship badge */}
              {isAlice && (
                <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full shadow-md">
                  🍺 FLAGSHIP
                </div>
              )}

              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  {user.icon}
                  <div>
                    <h4 className="font-medium text-gray-800">
                      {user.name}
                    </h4>
                    <p className="text-sm text-gray-600">
                      {user.email}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {user.description}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-medium text-gray-700">
                    Beer Progress
                  </div>
                  <div className="text-lg font-bold text-amber-600">
                    {user.beerProgress.completed}/{user.beerProgress.required}
                  </div>
                  <div className="text-xs text-gray-500">
                    {user.beerProgress.percentage}%
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-3">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`
                      h-full rounded-full transition-all duration-300
                      ${isCarol 
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500' 
                        : isAlice 
                          ? 'bg-gradient-to-r from-amber-400 to-orange-500' 
                          : 'bg-gradient-to-r from-blue-400 to-indigo-500'
                      }
                    `}
                    style={{ width: `${user.beerProgress.percentage}%` }}
                  />
                </div>
              </div>

              {/* Special feature highlight */}
              <div className={`
                mt-2 p-2 rounded-md text-xs font-medium text-center
                ${isCarol 
                  ? 'bg-green-100 text-green-800' 
                  : isAlice 
                    ? 'bg-amber-100 text-amber-800' 
                    : 'bg-blue-100 text-blue-800'
                }
              `}>
                {user.specialFeature}
              </div>

              {/* Selection indicator */}
              {isSelected && (
                <div className="mt-2 flex items-center justify-center space-x-1 text-blue-600">
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                  <span className="text-xs font-medium">SELECTED</span>
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Demo instructions */}
      <div className="mt-4 p-3 bg-gray-100 rounded-md">
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          🎯 Demo Scenarios:
        </h4>
        <ul className="text-xs text-gray-600 space-y-1">
          <li><strong>Alice:</strong> Perfect "almost there" moment (6/7 trips)</li>
          <li><strong>Bob:</strong> Multi-reward portfolio management</li>
          <li><strong>Carol:</strong> Successful redemption experience</li>
        </ul>
      </div>
    </div>
  );
}