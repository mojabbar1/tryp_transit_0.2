function assertRequired(name: string, value: string | undefined): string {
	if (!value || value.trim() === '') {
		throw new Error(`Missing required environment variable: ${name}`)
	}
	return value.trim()
}

function getOptional(name: string, defaultValue: string): string {
	return process.env[name]?.trim() || defaultValue
}

function getBooleanFlag(name: string, defaultValue = false): boolean {
	const value = process.env[name]?.toLowerCase().trim()
	if (value === undefined) return defaultValue
	return value === 'true' || value === '1'
}

export const NODE_ENV = process.env.NODE_ENV || 'development'
export const DEMO_MODE = getBooleanFlag('DEMO_MODE')
export const AI_PROVIDER = (getOptional('AI_PROVIDER', 'gemini') as 'gemini' | 'openai' | 'mock')

export const GEMINI_API_KEY = DEMO_MODE ? 'demo-key' : process.env.GEMINI_API_KEY
export const OPENAI_API_KEY = DEMO_MODE ? 'demo-key' : getOptional('OPENAI_API_KEY', '')

// Do not assert at module import time to avoid hard crashes in dev
export const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY?.trim() || ''
export const RIDERSHIP_API_BASE_URL = getOptional('RIDERSHIP_API_BASE_URL', 'http://localhost:5001')
export const DATABASE_URL = process.env.DATABASE_URL

export interface ConfigValidation {
	valid: boolean
	errors: string[]
	warnings: string[]
}

export function validateConfig(): ConfigValidation {
	const errors: string[] = []
	const warnings: string[] = []
	try {
		// Only require TomTom key when not in demo mode
		if (!DEMO_MODE) {
			assertRequired('NEXT_PUBLIC_TOMTOM_API_KEY', process.env.NEXT_PUBLIC_TOMTOM_API_KEY)
		}
		// DATABASE_URL may be optional for demo-only flows
		if (!DEMO_MODE) {
			assertRequired('DATABASE_URL', process.env.DATABASE_URL)
		}
		if (NODE_ENV === 'production' && !DEMO_MODE) {
			if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
				errors.push('Either GEMINI_API_KEY or OPENAI_API_KEY required in production')
			}
		}
		if (DEMO_MODE && NODE_ENV === 'production') {
			warnings.push('DEMO_MODE enabled in production environment')
		}
	} catch (e) {
		errors.push((e as Error).message)
	}
	return { valid: errors.length === 0, errors, warnings }
}

export interface SecurityValidation {
	secure: boolean
	violations: string[]
	recommendations: string[]
}

export function validateSecurity(): SecurityValidation {
	const violations: string[] = []
	const recommendations: string[] = []
	if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) violations.push('GEMINI_API_KEY exposed as NEXT_PUBLIC_')
	if (process.env.NEXT_PUBLIC_OPENAI_API_KEY) violations.push('OPENAI_API_KEY exposed as NEXT_PUBLIC_')
	if (process.env.NEXT_PUBLIC_DATABASE_URL) violations.push('DATABASE_URL exposed as NEXT_PUBLIC_')
	if (NODE_ENV === 'production' && !DEMO_MODE) {
		if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) violations.push('No AI API keys configured for production')
	}
	if (NODE_ENV === 'production' && !(process.env.DATABASE_URL || '').includes('ssl=true')) {
		recommendations.push('Consider enabling SSL for database connections in production')
	}
	if (DEMO_MODE && NODE_ENV === 'production') {
		recommendations.push('DEMO_MODE should not be enabled in production')
	}
	return { secure: violations.length === 0, violations, recommendations }
}

export function runPreflight(): { success: boolean; message: string } {
	try {
		const configValidation = validateConfig()
		if (!configValidation.valid) {
			return { success: false, message: `Configuration errors: ${configValidation.errors.join(', ')}` }
		}
		const securityValidation = validateSecurity()
		if (!securityValidation.secure) {
			return { success: false, message: `Security violations: ${securityValidation.violations.join(', ')}` }
		}
		return { success: true, message: 'Preflight checks passed' }
	} catch (e) {
		return { success: false, message: `Preflight failed: ${(e as Error).message}` }
	}
}

export function getConfigSummary() {
	return {
		nodeEnv: NODE_ENV,
		demoMode: DEMO_MODE,
		aiProvider: AI_PROVIDER,
		hasGeminiKey: !!process.env.GEMINI_API_KEY,
		hasOpenAiKey: !!process.env.OPENAI_API_KEY,
		hasTomTomKey: !!process.env.NEXT_PUBLIC_TOMTOM_API_KEY,
		ridershipsApiUrl: RIDERSHIP_API_BASE_URL,
	}
}


