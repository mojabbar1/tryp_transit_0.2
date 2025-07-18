// Simple script to test Gemini API
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Get API key from command line or environment
const apiKey = process.env.GEMINI_API_KEY || process.argv[2];

if (!apiKey) {
  console.error('Please provide a Gemini API key as an argument or set GEMINI_API_KEY environment variable');
  process.exit(1);
}

async function testGemini() {
  try {
    console.log('Initializing Gemini with API key:', apiKey.substring(0, 5) + '...');
    const genAI = new GoogleGenerativeAI(apiKey);
    
    console.log('Creating model instance...');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    console.log('Sending test prompt to Gemini API...');
    const prompt = 'Return a simple JSON object with fields: name, age, city. Make sure it\'s valid JSON.';
    
    const response = await model.generateContent(prompt);
    const result = response.response.text();
    
    console.log('\nRaw Gemini response:');
    console.log('-------------------');
    console.log(result);
    console.log('-------------------');
    
    // Try to parse as JSON
    try {
      const parsedJson = JSON.parse(result);
      console.log('\nSuccessfully parsed as JSON:', parsedJson);
    } catch (error) {
      console.log('\nFailed to parse as JSON:', error.message);
      
      // Check if response contains markdown code blocks
      if (result.includes('```json') && result.includes('```')) {
        try {
          console.log('\nAttempting to extract JSON from markdown code block...');
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            const extractedJson = jsonMatch[1].trim();
            console.log('Extracted JSON from markdown:', extractedJson);
            const parsedJson = JSON.parse(extractedJson);
            console.log('Successfully parsed extracted JSON:', parsedJson);
          }
        } catch (extractError) {
          console.log('Failed to extract JSON from markdown:', extractError.message);
        }
      }
    }
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error testing Gemini API:', error);
  }
}

testGemini();