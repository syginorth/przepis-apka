/* Połączenie z Supabase: logowanie, rodzina, adapter synchronizacji, odczyt przez AI. */
(function (root) {
  'use strict';

  const config = root.MAMA_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabaseKey && root.supabase);
  const client = configured
    ? root.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'przepisy-mamy-auth' }
      })
    : null;

  function friendly(error) {
    const text = `${error?.message || error || ''}`;
    if (/Invalid login credentials/i.test(text)) return new Error('Nieprawidłowy e-mail lub hasło.');
    if (/Email not confirmed/i.test(text)) return new Error('Najpierw potwierdź adres e-mail (link w wiadomości od Supabase).');
    if (/already registered/i.test(text)) return new Error('To konto już istnieje. Zaloguj się.');
    if (/Password should be/i.test(text)) return new Error('Hasło musi mieć co najmniej 6 znaków.');
    if (/wrong code/i.test(text)) return new Error('Nie znam takiego kodu. Sprawdź litery.');
    if (/already in family/i.test(text)) return new Error('To konto jest już połączone z książką przepisów.');
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return new Error('Brak połączenia z internetem.');
    return error instanceof Error ? error : new Error(text || 'Coś poszło nie tak.');
  }
  const check = ({ data, error }) => { if (error) throw friendly(error); return data; };

  const remote = {
    async upsertRecipe(row) { return check(await client.from('recipes').upsert(row).select().single()); },
    async updateRecipeIf(row, base) {
      const { id, ...fields } = row;
      const rows = check(await client.from('recipes').update(fields).eq('id', id).eq('updated_at', base).select());
      return rows[0] || null;
    },
    async getRecipe(id) { return check(await client.from('recipes').select().eq('id', id).maybeSingle()); },
    async upsertShop(row) { return check(await client.from('shopping_items').upsert(row).select().single()); },
    async changedSince(table, since) {
      const all = [];
      for (let from = 0; ; from += 500) {
        let query = client.from(table).select().order('updated_at').order('id').range(from, from + 499);
        if (since) query = query.gt('updated_at', since);
        const rows = check(await query);
        all.push(...rows);
        if (rows.length < 500) return all;
      }
    },
    async uploadImage(household, hash, bytes, type) {
      const { error } = await client.storage.from('recipe-images').upload(`${household}/${hash}`, new Blob([bytes], { type }), { contentType: type, upsert: false });
      // Ten sam plik już jest (nazwa to skrót zawartości) — to nie błąd.
      if (error && !/exists|Duplicate|409/i.test(`${error.message} ${error.statusCode || ''}`)) throw friendly(error);
    },
    async downloadImage(household, hash) {
      const blob = check(await client.storage.from('recipe-images').download(`${household}/${hash}`));
      return { bytes: await blob.arrayBuffer(), type: blob.type || 'image/jpeg' };
    },
    async listInbox() { return check(await client.from('inbox').select().order('created_at', { ascending: false })); },
    async deleteInbox(id) { check(await client.from('inbox').delete().eq('id', id)); }
  };

  async function callFunction(path, body) {
    const { data, error } = await client.functions.invoke(`przepis/${path}`, { body });
    if (error) {
      let body = {};
      try { body = await error.context.json(); } catch {}
      const failure = new Error(body.message || (/Failed to send|fetch/i.test(error.message) ? 'Brak połączenia z internetem.' : 'Nie udało się odczytać przepisu. Spróbuj ponownie.'));
      failure.code = body.code || '';
      throw failure;
    }
    return data;
  }

  root.MamaCloud = {
    configured,
    remote,
    async session() { return configured ? (await client.auth.getSession()).data.session : null; },
    onAuthChange(callback) { if (configured) client.auth.onAuthStateChange((event, session) => callback(event, session)); },
    async signIn(email, password) { return check(await client.auth.signInWithPassword({ email, password })).user; },
    async signUp(email, password) {
      const data = check(await client.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } }));
      return { user: data.user, needsConfirmation: !data.session };
    },
    async signOut() { await client.auth.signOut(); },
    async family() {
      const rows = check(await client.from('households').select('id,name,join_code'));
      return rows[0] || null;
    },
    async createFamily(name) { return check(await client.rpc('create_family', { p_name: name })); },
    async joinFamily(code) { return check(await client.rpc('join_family', { p_code: code })); },
    readRecipe: body => callFunction('read', body),
    newShortcutToken: () => callFunction('token', {}),
    shortcutUrl: () => `${config.supabaseUrl}/functions/v1/przepis/shortcut`,
    /** Zmiany z drugiego telefonu na żywo. */
    listen(onChange) {
      if (!configured) return () => {};
      const channel = client.channel('rodzina');
      for (const table of ['recipes', 'shopping_items', 'inbox']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
      channel.subscribe();
      return () => client.removeChannel(channel);
    }
  };
})(globalThis);
