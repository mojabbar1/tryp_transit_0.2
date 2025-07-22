// CRITICAL: Ensure enum values match Prisma schema exactly
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

// Core Interfaces
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