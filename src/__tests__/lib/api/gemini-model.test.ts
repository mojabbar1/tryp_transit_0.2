/**
 * Unit tests for the Gemini model configuration sent through the SDK
 */

const mockGetGenerativeModel = jest.fn((params: unknown) => ({ params }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

describe('getGeminiModel', () => {
  const savedKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;

  // Load a fresh module per test so the cached client/model singletons reset
  const loadGemini = () => require('@/lib/api/gemini') as typeof import('@/lib/api/gemini');

  beforeEach(() => {
    jest.resetModules();
    mockGetGenerativeModel.mockClear();
    process.env.GEMINI_API_KEY = 'placeholder-configured-value';
    delete process.env.GEMINI_MODEL;
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
    if (savedModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = savedModel;
  });

  it('requests the default model with no deprecated sampling params or output cap', () => {
    loadGemini().getGeminiModel();

    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-3.8-flash' });
  });

  it('requests the GEMINI_MODEL override', () => {
    process.env.GEMINI_MODEL = 'gemini-override';

    loadGemini().getGeminiModel();

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-override' });
  });
});
