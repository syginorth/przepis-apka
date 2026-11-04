import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
const { parseText, validateRecipe, plural } = globalThis.MamaCore;
const server = await import('../supabase/functions/przepis/recipe.mjs');

test('wklejony opis dzieli się na składniki i kroki', () => {
  const r = parseText('Kurczak curry\nCzas: 25 min\nSkładniki:\n- 2 filety\n- mleko kokosowe\nPrzygotowanie:\n1. Pokrój\n2. Duś');
  assert.equal(r.title, 'Kurczak curry');
  assert.deepEqual(r.ingredients, ['2 filety', 'mleko kokosowe']);
  assert.deepEqual(r.steps, ['Pokrój', 'Duś']);
  assert.equal(r.minutes, 25);
  assert.deepEqual(r.tags, ['Kurczak', 'Do 30 min']);
});

test('„Do 30 min” wynika z czasu, nie z ręcznego wyboru', () => {
  assert.deepEqual(validateRecipe({ title: 'x', ingredients: ['a'], minutes: 90, tags: ['Do 30 min', 'Zupy'] }).tags, ['Zupy']);
  assert.deepEqual(validateRecipe({ title: 'x', ingredients: ['a'], minutes: 15, tags: [] }).tags, ['Do 30 min']);
});

test('przepis bez tytułu albo treści jest odrzucany', () => {
  assert.throws(() => validateRecipe({ title: ' ', ingredients: ['a'] }), /tytuł/);
  assert.throws(() => validateRecipe({ title: 'x', ingredients: [''], steps: [''] }), /składnik/);
});

test('polska odmiana', () => {
  assert.equal(plural(1, 'przepis', 'przepisy', 'przepisów'), '1 przepis');
  assert.equal(plural(3, 'przepis', 'przepisy', 'przepisów'), '3 przepisy');
  assert.equal(plural(12, 'przepis', 'przepisy', 'przepisów'), '12 przepisów');
  assert.equal(plural(22, 'przepis', 'przepisy', 'przepisów'), '22 przepisy');
});

test('serwer: odpowiedź AI jest czyszczona', () => {
  const d = server.cleanDraft({ title: ' Sernik ', minutes: 20, minutesEstimated: true, ingredients: ['twaróg', '', 5], steps: ['mieszaj'], categories: ['Ciasta i desery', 'Hakerzy'], emoji: '🍰', warnings: [] });
  assert.equal(d.title, 'Sernik');
  assert.deepEqual(d.ingredients, ['twaróg']);
  assert.deepEqual(d.tags, ['Ciasta i desery', 'Do 30 min']);
  assert.throws(() => server.cleanDraft(null));
});

test('serwer: sam link z FB to jasny komunikat, a link w opisie jest wyciągany', () => {
  assert.throws(() => server.checkSources({ link: 'https://www.facebook.com/reel/1' }), /link_only/);
  const s = server.checkSources({ text: 'Super ciasto https://www.facebook.com/reel/123 \nSkładniki: mąka' });
  assert.equal(s.link, 'https://www.facebook.com/reel/123');
  assert.ok(!s.text.includes('facebook'));
});

test('serwer: rozpoznaje obrazy po zawartości', () => {
  assert.equal(server.imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), 'image/jpeg');
  assert.equal(server.imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), 'image/png');
  assert.equal(server.imageType(new TextEncoder().encode('<html>')), '');
  assert.throws(() => server.checkSources({ images: [1, 2, 3, 4].map(() => new Uint8Array([0xff, 0xd8, 0xff, 0])) }), /too_many_images/);
});
