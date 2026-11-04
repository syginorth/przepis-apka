import 'fake-indexeddb/auto';
await import('../app/core.js');
await import('../app/store.js');
await import('../app/sync.js');

let dbCounter = 0;
export const openStore = () => globalThis.MamaStore.open(`test-${dbCounter++}`);

/** Atrapa Supabase: serwer nadaje updated_at i sprawdza wersję przy update. */
export function fakeServer() {
  let clock = Date.parse('2026-11-04T10:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const tables = { recipes: new Map(), shopping_items: new Map() };
  const storage = new Map();
  const calls = { uploads: 0, downloads: 0 };
  const save = (table, row) => { const full = { created_at: tick(), ...tables[table].get(row.id), ...row, updated_at: tick() }; tables[table].set(row.id, full); return structuredClone(full); };
  const remote = {
    async upsertRecipe(row) { return save('recipes', row); },
    async updateRecipeIf(row, base) {
      const current = tables.recipes.get(row.id);
      if (!current || current.updated_at !== base) return null;
      return save('recipes', row);
    },
    async getRecipe(id) { return structuredClone(tables.recipes.get(id) ?? null); },
    async upsertShop(row) { return save('shopping_items', row); },
    async changedSince(table, since) {
      return [...tables[table].values()].filter(r => !since || r.updated_at > since).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map(r => structuredClone(r));
    },
    async uploadImage(household, hash, bytes, type) { calls.uploads++; storage.set(`${household}/${hash}`, { bytes, type }); },
    async downloadImage(household, hash) { calls.downloads++; return storage.get(`${household}/${hash}`); },
    async listInbox() { return []; },
    async deleteInbox() {}
  };
  return { remote, tables, storage, calls, edit: (table, id, fields) => save(table, { ...tables[table].get(id), ...fields }) };
}

export async function phone(server) {
  const store = await openStore();
  await store.setMeta('sync', { household: 'h1', user: 'u1' });
  return { store, sync: () => globalThis.MamaSync.syncOnce(store, server.remote) };
}

export const recipe = (fields = {}) => globalThis.MamaCore.validateRecipe({ title: 'Zupa', ingredients: ['woda'], steps: ['gotuj'], ...fields });
