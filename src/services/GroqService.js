import axios from 'axios';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Separate conversation history for every Discord user
const conversations = new Map();

const MAX_MESSAGES = 20;

export async function askGroq(userId, userMessage) {
  if (!conversations.has(userId)) {
    conversations.set(userId, [
      {
        role: 'system',
        content:
          'You are ORBITLY, a friendly Discord AI assistant. Reply naturally and helpfully. Keep responses reasonably concise and do not use unnecessary formatting.',
      },
    ]);
  }

  const history = conversations.get(userId);

  // Add user's message
  history.push({
    role: 'user',
    content: userMessage,
  });

  // Keep the system prompt + latest 20 messages
  if (history.length > MAX_MESSAGES + 1) {
    history.splice(1, history.length - (MAX_MESSAGES + 1));
  }

  const response = await axios.post(
    GROQ_API_URL,
    {
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: history,
      temperature: 0.7,
      max_tokens: 1000,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const aiResponse = response.data.choices[0].message.content;

  // Save AI response to this user's conversation
  history.push({
    role: 'assistant',
    content: aiResponse,
  });

  return aiResponse;
}

export function clearConversation(userId) {
  conversations.delete(userId);
}