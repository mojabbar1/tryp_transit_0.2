'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { AdditionalRide, CitationRef, IncentiveDetails, TransitAlert, TransitBasis, TransitReason } from '@/lib/contracts/transit-insights';

/** One trip result as the routes page shows it; every measurement may be null (unavailable) on a successful trip. */
export interface TripSummary {
  travelTime: number | null;
  trafficDensity: string | null;
  costSavings: number | null;
  additionalRides: AdditionalRide[];
  incentiveDetails: IncentiveDetails | null;
  offerActive: boolean;
  isDemo: boolean;
  // P4b, optional so a P1-shaped summary still renders.
  transitBasis?: TransitBasis;
  leaveBy?: string;
  routeShortName?: string;
  nextDepartures?: string[];
  transitReason?: TransitReason;
  alerts?: TransitAlert[];
  sources?: CitationRef[];
  citations?: string[];
  // The scheduled trip's full times and days (offset-qualified), and the region's zone and the moment the answer was
  // made, so a trip on another day is shown with its day (P4b review).
  leaveByAt?: string;
  departureAt?: string;
  arrivalAt?: string;
  serviceDate?: string;
  targetAt?: string;
  timezone?: string;
  generatedAt?: string;
}

interface TravelContextProps extends TripSummary {
  /** True once a trip result was received, so an all-unavailable result still renders. */
  hasTrip: boolean;
  setTravelData: (data: TripSummary) => void;
}

const EMPTY_TRIP: TripSummary = {
  travelTime: null,
  trafficDensity: null,
  costSavings: null,
  additionalRides: [],
  incentiveDetails: null,
  offerActive: false,
  isDemo: false,
};

const TravelContext = createContext<TravelContextProps | undefined>(undefined);

export const useTravelContext = () => {
  const context = useContext(TravelContext);
  if (!context) {
    throw new Error('useTravelContext must be used within a TravelProvider');
  }
  return context;
};

interface TravelProviderProps {
  children: ReactNode;
}

export const TravelProvider = ({ children }: TravelProviderProps) => {
  const [trip, setTrip] = useState<TripSummary & { hasTrip: boolean }>({ ...EMPTY_TRIP, hasTrip: false });

  const setTravelData = (data: TripSummary) => {
    setTrip({ ...data, costSavings: data.costSavings !== undefined ? data.costSavings : null, hasTrip: true });
  };

  return <TravelContext.Provider value={{ ...trip, setTravelData }}>{children}</TravelContext.Provider>;
};
