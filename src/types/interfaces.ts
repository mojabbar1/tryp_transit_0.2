import { StaticImageData } from 'next/image';
import type { LatLng } from '@/lib/contracts/transit-insights';

// The transit-insights types live in the zod contract; these re-exports keep the existing names.
export type {
  AdditionalRide,
  Comparison,
  IncentiveDetails,
  Meta,
  SourceRef,
  TransitInsightRequest,
  TransitInsightRequest as RequestBody,
  TransitInsightResponse,
} from '@/lib/contracts/transit-insights';

export type LocationInterface = LatLng;

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

export interface BusStopCoordinates {
  [key: string]: LocationInterface;
}

// Error response interface
export interface ApiErrorResponse {
  error: string;
  details?: string;
}

// GET /api/health — booleans only, never configuration values
export interface HealthResponse {
  status: 'ok';
  configured: {
    llm: boolean;
    traffic: boolean;
  };
}
