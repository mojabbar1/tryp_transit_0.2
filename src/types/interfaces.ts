import { StaticImageData } from 'next/image';

export interface BackgroundPhotoProps {
  imgOne: StaticImageData;
  imgTwo: StaticImageData;
  imgThree: StaticImageData;
  imgFour: StaticImageData;
}

export interface Coordinates {
  latitude: number | null;
  longitude: number | null;
}

export interface GeolocationContextProps {
  coordinates: Coordinates;
  error: string | null;
}

export interface TrafficData {
  flow: any;
  incidents: any;
}

export interface LocationInterface {
  lat: number;
  lng: number;
}

export interface RequestBody {
  departure: LocationInterface;
  destination: LocationInterface;
  timeToDestination: string;
}

export interface TravelContextProps {
  travelTime: number | null;
  trafficDensity: string | null;
  costSavings: number | null;
  setTravelData: (data: {
    travelTime: number | null;
    trafficDensity: string | null;
    costSavings: number | null;
  }) => void;
}

export interface BusStopCoordinates {
  [key: string]: LocationInterface;
}

// Enhanced interfaces for Phase 2 transit insights
export interface IncentiveDetails {
  type: 'eCredit' | 'partnerDiscount' | 'funReward';
  description: string;
  value: string;
}

export interface AdditionalRide {
  departureTime?: string; // HH:MM format
  travelTime: number;
  trafficDensity: 'Light' | 'Medium' | 'Heavy';
}

export interface TransitInsightResponse {
  travelTime: number | null;
  trafficDensity: 'Light' | 'Medium' | 'Heavy' | null;
  costSavingsPerTrip: string | null;
  nudgeMessage: string | null;
  incentiveDetails: IncentiveDetails | null;
  additionalRides: AdditionalRide[] | null;
}

// Form submission interface
export interface TransitInsightRequest {
  fromLocation: string;
  toLocation: string;
  timeToDestination: string; // ISO string
}

// Error response interface
export interface ApiErrorResponse {
  error: string;
  details?: string;
}
