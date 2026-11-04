/* Dane na telefonie (IndexedDB): przepisy, zakupy, zdjęcia i ustawienia.
   Każda zmiana lokalna dostaje dirty=true i rosnące localRev; synchronizacja
   czyści dirty tylko wtedy, gdy w międzyczasie nic się nie zmieniło. */
(function (root) {
  'use strict';

  const DB_NAME = 'przepisy-mamy-v2';

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function open(name = DB_NAME) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('recipes', { keyPath: 'id' });
        db.createObjectStore('shop', { keyPath: 'id' });
        db.createObjectStore('images', { keyPath: 'hash' });
        db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(createStore(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Zamknij inne karty z aplikacją i spróbuj ponownie.'));
    });
  }

  function createStore(db) {
    db.onversionchange = () => db.close();

    function run(names, mode, work) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(names, mode);
        let result;
        Promise.resolve(work(tx)).then(value => { result = value; }, error => { reject(error); try { tx.abort(); } catch {} });
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Zapis przerwany.'));
      });
    }

    const store = {
      all: name => run([name], 'readonly', tx => request(tx.objectStore(name).getAll())),
      get: (name, key) => run([name], 'readonly', tx => request(tx.objectStore(name).get(key))),
      getMeta: (key, fallback = null) => run(['meta'], 'readonly', tx => request(tx.objectStore('meta').get(key))).then(v => v ?? fallback),
      setMeta: (key, value) => run(['meta'], 'readwrite', tx => request(tx.objectStore('meta').put(value, key))),

      /** Zmiana wprowadzona na tym telefonie (do wysłania). */
      async saveLocal(name, item) {
        return run([name], 'readwrite', async tx => {
          const os = tx.objectStore(name);
          const current = await request(os.get(item.id));
          const next = { ...current, ...item, dirty: true, localRev: (current?.localRev || 0) + 1, base: current?.base ?? null };
          await request(os.put(next));
          return next;
        });
      },

      /** Usunięcie lokalne: niewysłane znika od razu, wysłane czeka na synchronizację. */
      async deleteLocal(name, id) {
        return run([name], 'readwrite', async tx => {
          const os = tx.objectStore(name);
          const current = await request(os.get(id));
          if (!current) return;
          if (!current.base) await request(os.delete(id));
          else await request(os.put({ ...current, deleted: true, dirty: true, localRev: (current.localRev || 0) + 1 }));
        });
      },

      /** Zapis wersji z serwera. Jeśli lokalnie zmieniono rekord po wysłaniu (localRev), zostaje dirty. */
      async applyRemote(name, item, sentRev = null) {
        return run([name], 'readwrite', async tx => {
          const os = tx.objectStore(name);
          const current = await request(os.get(item.id));
          if (current?.dirty && current.localRev !== sentRev) {
            await request(os.put({ ...current, base: item.updatedAt }));
            return false;
          }
          if (item.deleted) await request(os.delete(item.id));
          else await request(os.put({ ...item, dirty: false, base: item.updatedAt, localRev: current?.localRev || 0 }));
          return true;
        });
      },

      remove: (name, key) => run([name], 'readwrite', tx => request(tx.objectStore(name).delete(key))),
      putImage: image => run(['images'], 'readwrite', tx => request(tx.objectStore('images').put(image))),

      /** Czyści dane rodzinne po wylogowaniu (zdjęcia zostają jako pamięć podręczna). */
      clearFamilyData: () => run(['recipes', 'shop', 'meta'], 'readwrite', async tx => {
        await request(tx.objectStore('recipes').clear());
        await request(tx.objectStore('shop').clear());
        for (const key of ['sync', 'inbox']) await request(tx.objectStore('meta').delete(key));
      })
    };
    return store;
  }

  root.MamaStore = { open };
})(globalThis);
