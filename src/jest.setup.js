import '@testing-library/jest-dom'

// Mock environment variables for testing
process.env.GEMINI_API_KEY = 'test-gemini-key'
process.env.DEMO_MODE_ENABLED = 'true'
process.env.ENABLE_BEER_ANALYTICS = 'true'
process.env.NUDGE_CACHE_TTL = '300000'
process.env.API_TIMEOUT = '10000'

// Mock fetch for API tests
global.fetch = jest.fn()

// Add Web API polyfills for Node environment
if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(input, init) {
      this.url = input
      this.method = init?.method || 'GET'
      this.headers = new Map(Object.entries(init?.headers || {}))
      this.body = init?.body
    }
    
    async json() {
      return JSON.parse(this.body || '{}')
    }
  }
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init) {
      this.body = body
      this.status = init?.status || 200
      this.statusText = init?.statusText || 'OK'
      this.headers = new Map(Object.entries(init?.headers || {}))
    }
    
    async json() {
      return JSON.parse(this.body || '{}')
    }
  }
}

// Mock Prisma Client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    userProfile: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    partner: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    reward: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    userRewardProgress: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    tripCompletion: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $disconnect: jest.fn(),
  })),
}))

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => '/rewards',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
})