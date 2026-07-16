import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const MAX_ATTEMPTS = 2;

function containsTarget(hint: string, target: string): boolean {
  return hint.toLowerCase().includes(target.toLowerCase());
}

function redactTarget(hint: string, target: string): string {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return hint.replace(new RegExp(escaped, 'gi'), '•••');
}

export async function generateHint(target: string, previousHints: string[] = []): Promise<string> {
  const previousBlock = previousHints.length > 0
    ? `\nClues already given for this word:\n${previousHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n- Your clue MUST take a completely different angle than the ones above — different imagery, different aspect of the word, different sentence shape. Do not rephrase an earlier clue.`
    : '';

  let lastHint: string | null = null;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [
          {
            role: 'user',
            content: `You are giving a hint in a word-guessing game. The secret word is "${target}".

Give one vague but useful clue. Rules:
- NEVER write the secret word itself, any word containing it, or any direct synonym${attempt > 0 ? ' — your previous attempt leaked the word; this is disqualifying' : ''}
- Describe a feeling, abstract association, category, or use
- Keep it under 12 words
- Be cryptic but fair — players should be able to make better guesses after reading it${previousBlock}
- Output only the clue, nothing else`,
          },
        ],
      });

      const block = msg.content[0];
      if (block?.type !== 'text') continue;
      const hint = block.text.trim();
      if (!hint) continue;
      if (!containsTarget(hint, target)) return hint;
      lastHint = hint;
    }
  } catch {
    return 'Hint unavailable.';
  }

  // Both attempts leaked the word — redact rather than reveal
  if (lastHint) return redactTarget(lastHint, target);
  return 'Hint unavailable.';
}
