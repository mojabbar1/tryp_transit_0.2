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

// Beer Rewards System Interfaces
export enum RewardType {
  ECREDIT = "ECREDIT",
  FREE_COFFEE = "FREE_COFFEE", 
  FREE_APPETIZER = "FREE_APPETIZER",
  FREE_BEER = "FREE_BEER"      // FLAGSHIP FEATURE
}

export enum PartnerCategory {
  COFFEE = "COFFEE",
  RESTAURANT = "RESTAURANT",
  RETAIL = "RETAIL", 
  ECREDIT = "ECREDIT",
  BAR = "BAR"                  // REQUIRED FOR BEER PARTNERS
}

export enum UrgencyLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high"
}

export enum TimeWindow {
  WEEK = "week",
  TWO_WEEKS = "2weeks"
}

// Core Beer Rewards Interfaces
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface Partner {
  id: string;
  name: string;
  category: PartnerCategory;
  address: string;
  lat: number;
  lng: number;
  operatingHours: OperatingHours;
}

export interface Reward {
  id: string;
  partnerId: string;
  title: string;
  description: string;
  requiredTrips: number;
  timeWindow: TimeWindow | null;
  rewardType: RewardType;
}

export interface UserRewardProgress {
  id: string;
  userId: string;
  rewardId: string;
  completedTrips: number;
  lastTripDate: Date | null;
  isEarned: boolean;
  redemptionCode: string | null;
  earnedAt: Date | null;
  expiresAt: Date | null;
  resetDate: Date | null;
}

export interface NudgeContext {
  userId: string;
  userName: string;
  currentProgress: UserRewardProgress[];
  nearbyPartners: Partner[];
  timeOfDay: string;
}

export interface GeneratedNudge {
  message: string;
  urgencyLevel: UrgencyLevel;
  relevantReward: Reward | null;
}

export interface TripCompletion {
  id: string;
  userId: string;
  completedAt: Date;
}

export interface OperatingHours {
  open: string; // "16:00" format
  close: string; // "23:59" format
}

// Business Logic Interfaces
export interface BeerNudgeContext {
  contextType: 'TGIF_HAPPY_HOUR' | 'WEEKEND_RELAXATION' | 'WEEKDAY_UNWIND' | 'LATE_NIGHT_SOCIAL' | 'GENERAL_BEER_CONTEXT';
  timeOfDay: string;
  dayOfWeek: number;
}

export interface RewardThreshold {
  rewardType: RewardType;
  requiredTrips: number;
  estimatedValue: string;
  rationale: string;
}
