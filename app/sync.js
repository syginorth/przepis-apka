/* Synchronizacja z rodziną: wysyła tylko zmienione przepisy i pozycje,
   pobiera tylko to, co zmieniło się od ostatniego razu.
   Zdjęcie wysyłane jest raz (nazwa = skrót SHA-256 zawartości).
   `remote` to adapter z cloud.js (w testach: atrapa w pamięci). */
(function (root) {
  'use strict';

  const OVERLAP_MS = 60 * 1000; // pobieramy z zakładką, żeby nic nie umknęło

  const recipeToRow = r => ({
    id: r.id, title: r.title, minutes: r.minutes || 0, minutes_estimated: !!r.minutesEstimated,
    ingredients: r.ingredients || [], steps: r.steps || [], tags: r.tags || [], link: r.link || '',
    images: r.images || [], emoji: r.emoji || '🍽️', bg: r.bg || 't2', deleted: !!r.deleted,
    created_at: r.createdAt || undefined
  });
  const rowToRecipe = row => ({
    id: row.id, title: row.title, minutes: row.minutes, minutesEstimated: row.minutes_estimated,
    ingredients: row.ingredients, steps: row.steps, tags: row.tags, link: row.link,
    images: row.images, emoji: row.emoji, bg: row.bg, deleted: row.deleted, createdAt: row.created_at, updatedAt: row.updated_at
  });
  const shopToRow = s => ({ id: s.id, name: s.name, from_title: s.from || '', recipe_id: s.recipeId || null, done: !!s.done, deleted: !!s.deleted });
  const rowToShop = row => ({ id: row.id, name: row.name, from: row.from_title, recipeId: row.recipe_id, done: row.done, deleted: row.deleted, updatedAt: row.updated_at });

  const sameContent = (a, b) => JSON.stringify({ ...recipeToRow(a), deleted: false, created_at: 0 }) === JSON.stringify({ ...recipeToRow(b), deleted: false, created_at: 0 });

  function newestCursor(previous, rows) {
    let max = previous ? Date.parse(previous) : 0;
    for (const row of rows) max = Math.max(max, Date.parse(row.updated_at));
    return max ? new Date(max).toISOString() : null;
  }

  async function uploadImages(store, remote, household, recipe) {
    for (const hash of recipe.images || []) {
      const image = await store.get('images', hash);
      if (!image || image.uploaded) continue;
      await remote.uploadImage(household, hash, image.bytes, image.type);
      await store.putImage({ ...image, uploaded: true });
    }
  }

  async function pushRecipe(store, remote, household, recipe, notices) {
    if (!recipe.deleted) await uploadImages(store, remote, household, recipe);
    const row = recipeToRow(recipe);
    if (!recipe.base) {
      const saved = await remote.upsertRecipe(row);
      await store.applyRemote('recipes', rowToRecipe(saved), recipe.localRev);
      return;
    }
    const saved = await remote.updateRecipeIf(row, recipe.base);
    if (saved) {
      await store.applyRemote('recipes', rowToRecipe(saved), recipe.localRev);
      return;
    }
    // Ktoś zmienił ten przepis w międzyczasie na drugim telefonie.
    const theirsRow = await remote.getRecipe(recipe.id);
    const theirs = theirsRow ? rowToRecipe(theirsRow) : null;
    if (!theirs || (theirs.deleted && recipe.deleted) || recipe.deleted || sameContent(recipe, theirs)) {
      // Usunięcie przegrywa z cudzą edycją; identyczna treść to nie konflikt.
      if (theirs) await store.applyRemote('recipes', theirs, recipe.localRev);
      else await store.remove('recipes', recipe.id);
      if (recipe.deleted && theirs && !theirs.deleted) notices.push(`Przepis „${theirs.title}” został zmieniony na drugim telefonie, więc go nie usunęłam.`);
      return;
    }
    if (theirs.deleted) {
      // Drugi telefon usunął, a tu ktoś edytował: przywracamy edytowaną wersję.
      const restored = await remote.updateRecipeIf(row, theirs.updatedAt);
      if (restored) await store.applyRemote('recipes', rowToRecipe(restored), recipe.localRev);
      return;
    }
    // Obie wersje zmienione: zachowujemy obie, nic nie ginie.
    const copy = { ...recipe, id: crypto.randomUUID(), title: `${recipe.title} (druga wersja)`.slice(0, 200), base: null, createdAt: new Date().toISOString() };
    await uploadImages(store, remote, household, copy);
    const savedCopy = await remote.upsertRecipe(recipeToRow(copy));
    await store.applyRemote('recipes', theirs, recipe.localRev);
    await store.applyRemote('recipes', rowToRecipe(savedCopy));
    notices.push(`„${recipe.title}” zmieniono na dwóch telefonach naraz. Zachowałam obie wersje.`);
  }

  async function pushShop(store, remote, item) {
    if (!item.base && item.deleted) { await store.remove('shop', item.id); return; }
    const saved = await remote.upsertShop(shopToRow(item));
    await store.applyRemote('shop', rowToShop(saved), item.localRev);
  }

  async function pull(store, remote, table, localName, convert, cursorKey, sync) {
    const since = sync[cursorKey] ? new Date(Date.parse(sync[cursorKey]) - OVERLAP_MS).toISOString() : null;
    const rows = await remote.changedSince(table, since);
    let changed = false;
    for (const row of rows) {
      const local = await store.get(localName, row.id);
      if (local?.dirty) continue; // wyślemy przy następnym razie (z kontrolą wersji)
      if (local && local.base === row.updated_at) continue;
      await store.applyRemote(localName, convert(row));
      changed = true;
    }
    sync[cursorKey] = newestCursor(sync[cursorKey], rows);
    return changed;
  }

  /** Jedna runda synchronizacji. Zwraca komunikaty dla użytkowniczki i czy coś się zmieniło. */
  async function syncOnce(store, remote) {
    const sync = await store.getMeta('sync', {});
    if (!sync.household) return { notices: [], changed: false };
    const notices = [];
    const recipes = await store.all('recipes');
    const dirtyRecipes = recipes.filter(r => r.dirty);
    for (const recipe of dirtyRecipes) await pushRecipe(store, remote, sync.household, recipe, notices);
    const dirtyShop = (await store.all('shop')).filter(s => s.dirty);
    for (const item of dirtyShop) await pushShop(store, remote, item);

    const pulledRecipes = await pull(store, remote, 'recipes', 'recipes', rowToRecipe, 'recipesCursor', sync);
    const pulledShop = await pull(store, remote, 'shopping_items', 'shop', rowToShop, 'shopCursor', sync);
    const inbox = await remote.listInbox();
    const oldInbox = await store.getMeta('inbox', []);
    await store.setMeta('inbox', inbox);
    const current = await store.getMeta('sync', {});
    if (current.household === sync.household) await store.setMeta('sync', { ...current, recipesCursor: sync.recipesCursor, shopCursor: sync.shopCursor, lastSync: new Date().toISOString() });
    const changed = dirtyRecipes.length > 0 || dirtyShop.length > 0 || pulledRecipes || pulledShop || JSON.stringify(oldInbox) !== JSON.stringify(inbox);
    return { notices, changed };
  }

  /** Brakujące zdjęcie pobieramy dopiero, gdy jest potrzebne na ekranie. */
  async function ensureImage(store, remote, hash) {
    const cached = await store.get('images', hash);
    if (cached) return cached;
    const sync = await store.getMeta('sync', {});
    if (!sync.household || !remote) return null;
    const { bytes, type } = await remote.downloadImage(sync.household, hash);
    const image = { hash, bytes, type, uploaded: true };
    await store.putImage(image);
    return image;
  }

  root.MamaSync = { syncOnce, ensureImage, recipeToRow, rowToRecipe, shopToRow, rowToShop };
})(globalThis);
