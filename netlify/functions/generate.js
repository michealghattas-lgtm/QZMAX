exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Read the request body sent from the frontend
    const { topic, count, optsPerQ } = JSON.parse(event.body);
    
    // Read the Gemini API key from Netlify's environment variables
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return { 
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "AI API key is missing on the server." })
      };
    }

    const prompt = `Generate ${count} multiple-choice trivia questions for a live party quiz. Topic/instructions: ${topic}. Each question must have exactly ${optsPerQ} answer options, with exactly one correct answer. Keep questions and options short enough to read at a glance on a phone screen. Add a brief one-sentence explanation of why the correct answer is right. Do not repeat questions. Return only the structured data.`;

    const schemaBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              correctIndex: { type: 'integer' },
              explanation: { type: 'string' }
            },
            required: ['question', 'options', 'correctIndex']
          }
        }
      }
    };

    // Make the secure server-side call to Google's API
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          'x-goog-api-key': apiKey 
        }, 
        body: JSON.stringify(schemaBody) 
      }
    );

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error?.message || "Error from Google AI");
    }

    // Extract the JSON string returned by Gemini
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
        throw new Error("Empty response from AI");
    }

    // Send the structured data back to the frontend
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: text
    };

  } catch (error) {
    console.error("Function error:", error);
    return { 
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};