interface AIClientOptions {
  timeoutMs?: number
}

export interface AIClient {
  generateTextJSON(prompt: string, options?: AIClientOptions): Promise<string>
}

class GeminiClient implements AIClient {
  async generateTextJSON(prompt: string, options: AIClientOptions = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 10000
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const enhancedPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, code fences, or explanations.`
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: enhancedPrompt }] }] }),
          signal: controller.signal,
        }
      )
      if (!res.ok) {
        throw new Error(`Gemini HTTP ${res.status}`)
      }
      const data = (await res.json()) as any
      const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new Error('Gemini empty response')
      return text
    } finally {
      clearTimeout(timeout)
    }
  }
}

class OpenAIClient implements AIClient {
  async generateTextJSON(prompt: string, options: AIClientOptions = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 10000
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not set')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const enhancedPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, code fences, or explanations.`
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: enhancedPrompt }],
          temperature: 0.2,
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
      const data = (await res.json()) as any
      const text: string | undefined = data?.choices?.[0]?.message?.content
      if (!text) throw new Error('OpenAI empty response')
      return text
    } finally {
      clearTimeout(timeout)
    }
  }
}

class MockClient implements AIClient {
  async generateTextJSON(_prompt: string): Promise<string> {
    return JSON.stringify({
      travelTime: 30,
      trafficDensity: 'Medium',
      costSavingsPerTrip: '2.50',
      nudgeMessage: 'Mock insight: Take the bus to save money and reduce stress.',
      incentiveDetails: {
        type: 'eCredit',
        description: 'Demo credit for your next ride',
        value: '1.00',
      },
      additionalRides: [
        { travelTime: 35, trafficDensity: 'Medium' }
      ],
    })
  }
}

function createAIClient(): AIClient {
  const provider = process.env.AI_PROVIDER || (process.env.USE_GEMINI === 'true' ? 'gemini' : 'gemini')

  switch (provider) {
    case 'gemini':
      return new GeminiClient()
    case 'openai':
      return new OpenAIClient()
    case 'mock':
      return new MockClient()
    default:
      return new GeminiClient()
  }
}

export const aiClient: AIClient = createAIClient()


