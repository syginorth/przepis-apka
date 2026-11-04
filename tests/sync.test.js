import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeServer, phone, recipe } from './helpers.js';

test('przepis z jednego telefonu pojawia się na drugim', async () => {
  const server = fakeServer();
  const mama = await phone(server), corka = await phone(server);
  await mama.store.saveLocal('recipes', recipe({ title: 'Rosół' }));
  await mama.sync();
  await corka.sync();
  const list = await corka.store.all('recipes');
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Rosół');
  assert.equal(list[0].dirty, false);
});

test('zdjęcie wysyłane jest raz, a druga synchronizacja nic nie wysyła ani nie pobiera', async () => {
  const server = fakeServer();
  const mama = await phone(server);
  const hash = 'a'.repeat(64);
  await mama.store.putImage({ hash, bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg', uploaded: false });
  await mama.store.saveLocal('recipes', recipe({ images: [hash] }));
  await mama.sync();
  await mama.sync();
  await mama.store.saveLocal('shop', { id: crypto.randomUUID(), name: 'mleko', done: false });
  await mama.sync();
  assert.equal(server.calls.uploads, 1);
  assert.equal(server.calls.downloads, 0);
});

test('druga synchronizacja bez zmian niczego nie wysyła', async () => {
  const server = fakeServer();
  const mama = await phone(server);
  await mama.store.saveLocal('recipes', recipe());
  const first = await mama.sync();
  const second = await mama.sync();
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
});

test('odhaczenie zakupu na jednym telefonie widać na drugim', async () => {
  const server = fakeServer();
  const mama = await phone(server), corka = await phone(server);
  const id = crypto.randomUUID();
  await corka.store.saveLocal('shop', { id, name: 'jajka', from: '', done: false });
  await corka.sync();
  await mama.sync();
  const item = await mama.store.get('shop', id);
  await mama.store.saveLocal('shop', { ...item, done: true });
  await mama.sync();
  await corka.sync();
  assert.equal((await corka.store.get('shop', id)).done, true);
});

test('jednoczesna edycja tego samego przepisu zachowuje obie wersje', async () => {
  const server = fakeServer();
  const mama = await phone(server), corka = await phone(server);
  const r = recipe({ title: 'Sernik' });
  await mama.store.saveLocal('recipes', r);
  await mama.sync();
  await corka.sync();
  await mama.store.saveLocal('recipes', { ...r, steps: ['piecz 60 min'] });
  await corka.store.saveLocal('recipes', { ...r, steps: ['piecz 45 min'] });
  await mama.sync();
  const result = await corka.sync();
  assert.equal(result.notices.length, 1);
  await mama.sync();
  for (const p of [mama, corka]) {
    const titles = (await p.store.all('recipes')).map(x => x.title).sort();
    assert.deepEqual(titles, ['Sernik', 'Sernik (druga wersja)']);
  }
});

test('usunięcie nie kasuje przepisu, który ktoś właśnie zmienił', async () => {
  const server = fakeServer();
  const mama = await phone(server), corka = await phone(server);
  const r = recipe({ title: 'Pierogi' });
  await mama.store.saveLocal('recipes', r);
  await mama.sync(); await corka.sync();
  await mama.store.saveLocal('recipes', { ...r, title: 'Pierogi ruskie' });
  await corka.store.deleteLocal('recipes', r.id);
  await mama.sync();
  await corka.sync();
  const left = await corka.store.all('recipes');
  assert.equal(left.length, 1);
  assert.equal(left[0].title, 'Pierogi ruskie');
});

test('usunięcie dociera na drugi telefon', async () => {
  const server = fakeServer();
  const mama = await phone(server), corka = await phone(server);
  const r = recipe();
  await mama.store.saveLocal('recipes', r);
  await mama.sync(); await corka.sync();
  await corka.store.deleteLocal('recipes', r.id);
  await corka.sync(); await mama.sync();
  assert.equal((await mama.store.all('recipes')).length, 0);
});

test('zmiana zrobiona w trakcie wysyłania nie ginie', async () => {
  const server = fakeServer();
  const mama = await phone(server);
  const r = recipe({ title: 'A' });
  await mama.store.saveLocal('recipes', r);
  const original = server.remote.upsertRecipe;
  server.remote.upsertRecipe = async row => {
    await mama.store.saveLocal('recipes', { ...r, title: 'B' }); // mama pisze dalej
    return original(row);
  };
  await mama.sync();
  server.remote.upsertRecipe = original;
  assert.equal((await mama.store.get('recipes', r.id)).dirty, true);
  await mama.sync();
  assert.equal(server.tables.recipes.get(r.id).title, 'B');
});

test('przepisy dodane bez konta trafiają do rodziny po zalogowaniu', async () => {
  const server = fakeServer();
  const mama = await phone(server);
  await mama.store.setMeta('sync', {});
  await mama.store.saveLocal('recipes', recipe({ title: 'Stary przepis' }));
  assert.equal((await mama.sync()).changed, false);
  await mama.store.setMeta('sync', { household: 'h1', user: 'u1' });
  await mama.sync();
  assert.equal([...server.tables.recipes.values()][0].title, 'Stary przepis');
});
