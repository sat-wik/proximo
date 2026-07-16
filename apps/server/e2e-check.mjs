// Throwaway end-to-end check for quick-match + bot. Run: node e2e-check.mjs
// Uses Node's built-in WebSocket client (Node 22+).
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:3111';
const WS_URL = 'ws://localhost:3111/signal';
const dictionary = JSON.parse(readFileSync('../../data/dictionary.json', 'utf-8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randWord = () => dictionary[Math.floor(Math.random() * dictionary.length)];

function connect(sessionId) {
  const ws = new WebSocket(WS_URL);
  const queue = [];
  const waiters = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  };
  const next = (timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
  const send = (msg) => ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    ws.onopen = () => { send({ type: 'join', sessionId }); resolve({ ws, next, send }); };
    ws.onerror = (e) => reject(new Error(`ws error: ${e.message ?? e}`));
  });
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ── 1. Full bot game ────────────────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/quick-match`, { method: 'POST' });
  const { sessionId, botDelayMs } = await res.json();
  check('quick-match returns session + delay', !!sessionId && botDelayMs === 1500);

  const c = await connect(sessionId);
  const joined = await c.next();
  check('waiter joins as host', joined.type === 'joined' && joined.role === 'host');

  // Bot should attach after ~1.5s and start the game
  const first = await c.next();
  check('bot attaches and game starts', first.type === 'game-state' && first.state.vsBot === true);
  check('human goes first in round 1', first.state.currentTurn === 'host');

  let state = first.state;
  let botGuesses = [];
  let sentNextRound = false;
  let sentGiveUp = false;

  const deadline = Date.now() + 120_000;
  while (state.phase !== 'match-over' && Date.now() < deadline) {
    if (state.phase === 'playing' && state.currentTurn === 'host' && !state.giveUpRequest) {
      if (state.round === 2 && botGuesses.some((g) => g.round === 2)) {
        if (!sentGiveUp) { c.send({ type: 'give-up', scope: 'game' }); sentGiveUp = true; }
      } else {
        c.send({ type: 'submit-guess', word: randWord() });
      }
    } else if (state.phase === 'round-over') {
      if (!sentNextRound) { c.send({ type: 'next-round' }); sentNextRound = true; }
    }
    const msg = await c.next(15_000);
    if (msg.type === 'guess-rejected') continue; // duplicate random word — try again
    if (msg.type !== 'game-state') continue;
    const prevCount = state.guesses.length;
    state = msg.state;
    for (const g of state.guesses.slice(prevCount)) {
      if (g.player === 'guest') botGuesses.push({ ...g, round: state.round });
    }
    if (state.round === 2) sentNextRound = false;
  }

  const r1 = botGuesses.filter((g) => g.round === 1);
  check('bot made guesses in round 1', r1.length >= 3, `${r1.length} guesses`);
  const bestByTurn = [];
  let best = Infinity;
  for (const g of r1) { best = Math.min(best, g.rank); bestByTurn.push(best); }
  check('bot converged toward the target', bestByTurn[bestByTurn.length - 1] < bestByTurn[0]);
  check('round 1 ended (kill or give-up)', botGuesses.some((g) => g.round === 2) || state.phase === 'match-over');
  check('bot played round 2 after next-round', botGuesses.some((g) => g.round === 2));
  check('give-up ended the match (bot accepted if needed)', state.phase === 'match-over');
  check('bot (guest) won the match', state.matchWinner === 'guest');
  console.log(`     round-1 bot ranks: ${r1.map((g) => g.rank).join(', ')}`);

  // Reconnect after match over: state replays
  c.ws.close();
  await sleep(300);
  const c2 = await connect(sessionId);
  const j2 = await c2.next();
  const replay = await c2.next();
  check('reconnect replays state', j2.type === 'joined' && replay.type === 'game-state' && replay.state.phase === 'match-over');
  c2.ws.close();
}

// ── 2. Two humans pair up, no bot ───────────────────────────────────────────
{
  const a = await (await fetch(`${BASE}/quick-match`, { method: 'POST' })).json();
  const b = await (await fetch(`${BASE}/quick-match`, { method: 'POST' })).json();
  check('second caller pairs into waiting session', a.sessionId === b.sessionId);

  const ca = await connect(a.sessionId);
  await ca.next(); // joined host
  const cb = await connect(b.sessionId);
  const jb = await cb.next();
  check('second player joins as guest', jb.role === 'guest');
  const sa = await ca.next();
  check('human-vs-human game starts without vsBot', sa.type === 'game-state' && !sa.state.vsBot);
  await sleep(2500); // past bot timeout — bot must NOT butt in
  ca.send({ type: 'submit-guess', word: randWord() });
  const after = await ca.next();
  check('no bot attached after timeout in paired game', after.type !== 'game-state' || !after.state.vsBot);
  ca.ws.close(); cb.ws.close();
}

// ── 3. Stale waiter cleanup ─────────────────────────────────────────────────
{
  const a = await (await fetch(`${BASE}/quick-match`, { method: 'POST' })).json();
  const ca = await connect(a.sessionId);
  await ca.next();
  ca.ws.close(); // waiter leaves
  await sleep(300);
  const b = await (await fetch(`${BASE}/quick-match`, { method: 'POST' })).json();
  check('closed waiter frees the slot', b.sessionId !== a.sessionId);
}

// ── 4. Rate limit on /quick-match ───────────────────────────────────────────
{
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE}/quick-match`, { method: 'POST' });
    if (res.status === 429) { got429 = true; break; }
  }
  check('rate limit kicks in on /quick-match', got429);
  const rank = await fetch(`${BASE}/rank?target=ocean&word=sea`);
  check('/rank debug endpoint removed', rank.status === 404);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
