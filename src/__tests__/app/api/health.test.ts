/**
 * Unit tests for the /api/health route
 */

import { GET } from '@/app/api/health/route';
import { checkRidershipServiceHealth } from '@/lib/api/ridership';

jest.mock('@/lib/api/ridership', () => ({
  checkRidershipServiceHealth: jest.fn(),
}));

const mockedRidershipHealth = checkRidershipServiceHealth as jest.MockedFunction<
  typeof checkRidershipServiceHealth
>;

const ENV_NAMES = [
  'USE_GEMINI',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'TOMTOM_API_KEY',
  'NEXT_PUBLIC_TOMTOM_API_KEY',
] as const;

const PLACEHOLDER = 'placeholder-configured-value';

describe('GET /api/health', () => {
  const savedEnv: Partial<Record<(typeof ENV_NAMES)[number], string>> = {};

  beforeAll(() => {
    for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
  });

  beforeEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
    mockedRidershipHealth.mockReset();
  });

  afterAll(() => {
    for (const name of ENV_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  it('reports ok with the ridership service up and nothing configured', async () => {
    mockedRidershipHealth.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { ridershipService: 'up' },
      configured: { llm: false, traffic: false },
    });
  });

  it('reports the ridership service as down when the health probe fails', async () => {
    mockedRidershipHealth.mockResolvedValue(false);

    const body = await (await GET()).json();

    expect(body.status).toBe('ok');
    expect(body.checks.ridershipService).toBe('down');
  });

  it('checks the Gemini key when USE_GEMINI is "true"', async () => {
    mockedRidershipHealth.mockResolvedValue(true);
    process.env.USE_GEMINI = 'true';
    process.env.OPENAI_API_KEY = PLACEHOLDER;

    expect((await (await GET()).json()).configured.llm).toBe(false);

    process.env.GEMINI_API_KEY = PLACEHOLDER;
    expect((await (await GET()).json()).configured.llm).toBe(true);
  });

  it('checks the OpenAI key when USE_GEMINI is not "true"', async () => {
    mockedRidershipHealth.mockResolvedValue(true);
    process.env.GEMINI_API_KEY = PLACEHOLDER;

    expect((await (await GET()).json()).configured.llm).toBe(false);

    process.env.OPENAI_API_KEY = PLACEHOLDER;
    expect((await (await GET()).json()).configured.llm).toBe(true);
  });

  it('treats the server-only TOMTOM_API_KEY as traffic configured', async () => {
    mockedRidershipHealth.mockResolvedValue(true);
    process.env.TOMTOM_API_KEY = PLACEHOLDER;

    expect((await (await GET()).json()).configured.traffic).toBe(true);
  });

  it('exposes only booleans, never configuration values', async () => {
    mockedRidershipHealth.mockResolvedValue(true);
    process.env.USE_GEMINI = 'true';
    process.env.GEMINI_API_KEY = PLACEHOLDER;
    process.env.OPENAI_API_KEY = PLACEHOLDER;
    process.env.NEXT_PUBLIC_TOMTOM_API_KEY = PLACEHOLDER;

    const text = await (await GET()).text();

    expect(JSON.parse(text).configured).toEqual({ llm: true, traffic: true });
    expect(text).not.toContain(PLACEHOLDER);
  });
});
