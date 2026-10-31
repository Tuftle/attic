import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { chatgptFixture, claudeFixture, chatgptJson, CHAT } from '../gen/chat.js';
import { tokens, wordCount } from '../../site/src/sources/chat.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const gpt = chatgptFixture(), cl = claudeFixture();
const ctx = year => ({ year, timeZone: CHAT.zone, now: CHAT.now });

test('words and tokens', () => {
  assert.equal(wordCount('  two  words\n'), 2);
  assert.deepEqual(tokens('Please water the Tomatoes, and the tomatoes\u{2019} soil!\n```js\nignored code\n```'), ['water', 'tomatoes', 'tomatoes', 'soil']);
});

for (const [label, fx, id] of [['chatgpt', gpt, 'chatgpt'], ['claude', cl, 'claude']]) {
  test(`${label}: the cards match the truth`, async () => {
    const { results } = await readAll([file(`${label}-export.zip`, fx.zip)]);
    assert.ok(results[id], `${id} was found`);
    assert.equal(Object.keys(results).length, 1, 'the other chat source did not claim it');
    for (const year of CHAT.years) {
      const { cards } = makeYear(results, ctx(year));
      assertTruth(cards, fx.truth[year], `${label} ${year}`);
      assertCardWords(cards);
    }
  });
}

test('the top words card waits to be asked for, and titles are sensitive', async () => {
  const { results } = await readAll([file('x.zip', gpt.zip)]);
  const { cards } = makeYear(results, ctx(2025));
  const words = cards.find(c => c.id === 'chatgpt.top-words');
  assert.equal(words.optIn, true);
  assert.equal(words.sensitive, true);
  for (const id of ['chatgpt.longest', 'chatgpt.first']) assert.equal(cards.find(c => c.id === id).sensitive, true, id);
  for (const id of ['chatgpt.conversations', 'chatgpt.words', 'chatgpt.code', 'chatgpt.models']) assert.equal(cards.find(c => c.id === id).sensitive, false, id);
});

test('hidden nodes, tool messages and custom instructions are left out', async () => {
  const one = [{ ...gpt.convs[3], instructions: true }];
  const { results, notes } = await readAll([file('conversations.json', chatgptJson(one))]);
  assert.equal(results.chatgpt.store.length, one[0].msgs.length);
  assert.ok(notes.some(n => n.code === 'hidden'));
});

test('both exports dropped together make two decks', async () => {
  const { results } = await readAll([file('a.zip', gpt.zip), file('b.zip', cl.zip)]);
  assert.deepEqual(Object.keys(results).sort(), ['chatgpt', 'claude']);
});
