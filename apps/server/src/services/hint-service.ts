import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function generateHint(target: string): Promise<string> {
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content: `You are giving a hint in a word-guessing game. The secret word is "${target}".

Give one vague but useful clue. Rules:
- Never say the word itself or any direct synonym
- Describe a feeling, abstract association, category, or use
- Keep it under 12 words
- Be cryptic but fair — players should be able to make better guesses after reading it
- Output only the clue, nothing else`,
        },
      ],
    });

    const block = msg.content[0];
    if (block.type !== 'text') return 'Hint unavailable.';
    return block.text.trim();
  } catch {
    return 'Hint unavailable.';
  }
}
