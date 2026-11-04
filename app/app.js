/* Główna logika: stan, zdarzenia, zapis i synchronizacja. */
'use strict';

const { parseText, validateRecipe, withTimeTag, plural } = MamaCore;
const { esc } = MamaViews;
const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID();

const S = {
  screen: 'recipes', selected: '', filter: '', search: '',
  form: { text: '', link: '', images: [] }, // formularz „Dodaj przepis”
  draft: null,                                // przepis w edycji
  busy: false, error: '',
  recipes: [], shop: [], inbox: [], font: 1,
  cloudConfigured: MamaCloud.configured, user: null, family: null,
  syncStatus: '', canRead: false
};
let store;
let readAbort = null;

/* ---------- Pomocnicze ---------- */

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.textContent = ''; }, 4000);
}

async function ask(message, okLabel = 'Tak', danger = false) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `<form method="dialog"><p>${esc(message)}</p><div class="actions"><button value="no" class="secondary">Anuluj</button><button value="yes" class="${danger ? 'danger' : 'primary'}">${esc(okLabel)}</button></div></form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'yes'); }, { once: true });
    dialog.showModal();
  });
}

async function loadData() {
  S.recipes = (await store.all('recipes')).filter(r => !r.deleted).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  S.shop = (await store.all('shop')).filter(x => !x.deleted);
  S.inbox = await store.getMeta('inbox', []);
  S.font = (await store.getMeta('settings', {})).font || 1;
}

function render() {
  document.documentElement.style.setProperty('--scale', S.font);
  $('#main').innerHTML = MamaViews.render(S);
  $('#nav').innerHTML = MamaViews.nav(S);
  const r = S.screen === 'detail' && S.recipes.find(x => x.id === S.selected);
  document.title = r ? `${r.title} — Przepisy Mamy` : 'Przepisy Mamy';
  showImages();
}

function go(screen) {
  if (S.screen === 'loading') readAbort?.abort();
  S.screen = screen;
  S.error = '';
  render();
  window.scrollTo(0, 0);
  $('#main').focus({ preventScroll: true });
}

/* Ekran nie przerysowuje się w trakcie pisania. */
const isTyping = () => ['edit', 'add', 'loading'].includes(S.screen) || document.activeElement?.closest('form');

/* ---------- Zdjęcia ---------- */

const imageUrls = new Map();

async function imageUrl(hash) {
  if (imageUrls.has(hash)) return imageUrls.get(hash);
  const image = await MamaSync.ensureImage(store, S.family ? MamaCloud.remote : null, hash);
  if (!image) return null;
  const url = URL.createObjectURL(new Blob([image.bytes], { type: image.type }));
  imageUrls.set(hash, url);
  return url;
}

function showImages() {
  document.querySelectorAll('[data-img]').forEach(async el => {
    try {
      const url = await imageUrl(el.dataset.img);
      if (!url || !el.isConnected) return;
      const img = new Image();
      img.src = url;
      img.alt = el.dataset.alt || '';
      img.style.width = '100%';
      el.replaceChildren(img);
    } catch { /* brak internetu: zostaje emoji */ }
  });
}

/** Zmniejsza zdjęcie do 1600 px (JPEG), zapisuje na telefonie i zwraca jego skrót. */
async function addImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Wybierz zdjęcie lub zrzut ekranu.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (!(await store.get('images', hash))) await store.putImage({ hash, bytes, type: 'image/jpeg', uploaded: false });
    return hash;
  } catch {
    throw new Error('Nie mogę otworzyć tego zdjęcia. Wybierz zrzut ekranu.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imageDataUrl(hash) {
  const image = await store.get('images', hash);
  const bytes = new Uint8Array(image.bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${image.type};base64,${btoa(binary)}`;
}

/* ---------- Szkice (przetrwają zamknięcie aplikacji) ---------- */

function saveDrafts() {
  store.setMeta('drafts', { form: S.form, draft: S.draft }).catch(() => {});
}

function readEditor() {
  if (!$('#editor')) return;
  S.draft.title = $('#title').value;
  S.draft.minutes = Number($('#minutes').value) || 0;
  S.draft.link = $('#edit-link').value;
  document.querySelectorAll('[data-edit]').forEach(el => { S.draft[el.dataset.edit][Number(el.dataset.index)] = el.value; });
}

function readAddForm() {
  if (!$('#paste')) return;
  S.form.text = $('#paste').value;
  S.form.link = $('#source').value;
}

function openEditor(draft) {
  S.draft = {
    isNew: true, title: '', minutes: 0, minutesEstimated: false, tags: [], link: '', images: [], emoji: '🍽️', warnings: [],
    ...draft,
    ingredients: draft.ingredients?.length ? [...draft.ingredients] : [''],
    steps: draft.steps?.length ? [...draft.steps] : ['']
  };
  saveDrafts();
  go('edit');
}

/* ---------- Dodawanie przepisu ---------- */

async function readRecipe() {
  readAddForm();
  const { text, link, images } = S.form;
  if (!text.trim() && !images.length) {
    S.error = link ? 'Sam link nie wystarczy, bo Facebook nie pozwala odczytać rolki. Dodaj zrzuty ekranu albo wklej opis.' : 'Dodaj zrzuty ekranu albo wklej opis.';
    render();
    return;
  }
  if (!S.canRead) {
    try {
      if (!text.trim()) throw new Error('Odczyt zrzutów działa po zalogowaniu (Ustawienia). Możesz wpisać przepis ręcznie.');
      openEditor({ ...parseText(text), link, images });
      toast('Uporządkowałam tekst. Sprawdź wynik.');
    } catch (error) { S.error = error.message; render(); }
    return;
  }
  if (!navigator.onLine) { S.error = 'Brak internetu. Zrzuty są zapisane, spróbuj, gdy wróci połączenie.'; render(); return; }
  go('loading');
  const abort = readAbort = new AbortController();
  try {
    const body = { text, link, images: await Promise.all(images.map(imageDataUrl)) };
    const result = await MamaCloud.readRecipe(body);
    if (abort.signal.aborted) return;
    const d = result.draft;
    openEditor({ title: d.title, minutes: d.minutes, minutesEstimated: d.minutesEstimated, ingredients: d.ingredients, steps: d.steps, tags: d.tags, emoji: d.emoji, warnings: d.warnings, link: result.link || link, images });
  } catch (error) {
    if (abort.signal.aborted) return;
    // Bez klucza Gemini (lub po wyczerpaniu limitu) wklejony opis porządkujemy na telefonie.
    if (['not_configured', 'provider_limit'].includes(error.code) && text.trim()) {
      try {
        openEditor({ ...parseText(text), link, images });
        toast('Uporządkowałam tekst na telefonie. Sprawdź wynik.');
        return;
      } catch {}
    }
    S.screen = 'add';
    S.error = error.code === 'not_configured' ? 'Odczyt zrzutów nie jest jeszcze włączony. Wklej opis albo wpisz przepis ręcznie.' : error.message;
    render();
  }
}

async function saveRecipe() {
  readEditor();
  const d = S.draft;
  const recipe = validateRecipe(d);
  const existing = S.recipes.find(r => r.id === recipe.id);
  await store.saveLocal('recipes', { ...recipe, createdAt: existing?.createdAt || new Date().toISOString() });
  if (d.inboxId) await MamaCloud.remote.deleteInbox(d.inboxId).catch(() => {});
  if (d.isNew) S.form = { text: '', link: '', images: [] };
  S.draft = null;
  S.selected = recipe.id;
  saveDrafts();
  await loadData();
  if (d.inboxId) S.inbox = S.inbox.filter(x => x.id !== d.inboxId);
  go('detail');
  toast('✓ Przepis zapisany');
  scheduleSync();
}

function openInbox() {
  const item = S.inbox[0];
  if (!item) return;
  const d = item.draft || {};
  openEditor({ ...d, minutes: d.minutes || 0, link: item.link, images: item.images || [], inboxId: item.id, warnings: d.warnings || [] });
}

/* ---------- Lista zakupów ---------- */

async function addToShopping(names) {
  const r = S.recipes.find(x => x.id === S.selected);
  let added = 0;
  for (const name of names) {
    if (S.shop.some(x => x.name === name && x.recipeId === r.id && !x.done)) continue;
    await store.saveLocal('shop', { id: uid(), name, from: r.title, recipeId: r.id, done: false });
    added++;
  }
  await loadData();
  toast(added ? `✓ Dodano do listy: ${plural(added, 'pozycja', 'pozycje', 'pozycji')}` : 'To już jest na liście.');
  scheduleSync();
}

/* ---------- Konto i synchronizacja ---------- */

let syncTimer, syncing = false, retryDelay = 3000;

function scheduleSync(delay = 800) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(synchronize, delay);
}

async function synchronize() {
  if (!S.family || syncing) return;
  if (!navigator.onLine) { S.syncStatus = 'Brak internetu. Zmiany są zapisane na telefonie.'; return; }
  syncing = true;
  try {
    const run = () => MamaSync.syncOnce(store, MamaCloud.remote);
    const result = navigator.locks ? await navigator.locks.request('przepisy-sync', run) : await run();
    retryDelay = 3000;
    S.syncStatus = 'Wszystko zsynchronizowane.';
    result.notices.forEach(toast);
    if (result.changed) {
      await loadData();
      if (!isTyping()) render();
    }
  } catch (error) {
    S.syncStatus = 'Zmiany czekają na wysłanie.';
    if (/JWT|session|401/i.test(error.message)) { await refreshAccount(); }
    syncTimer = setTimeout(synchronize, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 120000);
  } finally {
    syncing = false;
  }
}

let stopListening = () => {};

async function refreshAccount() {
  if (!MamaCloud.configured) return;
  const session = await MamaCloud.session();
  S.user = session?.user || null;
  S.family = null;
  if (S.user) {
    try {
      S.family = await MamaCloud.family();
    } catch {
      // bez internetu korzystamy z zapamiętanej książki
      const sync = await store.getMeta('sync', {});
      if (sync.user === S.user.id && sync.household) S.family = { id: sync.household, join_code: sync.code || '' };
    }
  }
  S.canRead = Boolean(S.family);
  if (S.family) {
    const sync = await store.getMeta('sync', {});
    if (sync.household !== S.family.id || sync.user !== S.user.id) {
      // Inne konto lub rodzina niż ostatnio: zaczynamy pobieranie od nowa.
      await store.setMeta('sync', { household: S.family.id, user: S.user.id, code: S.family.join_code });
    }
    stopListening();
    stopListening = MamaCloud.listen(() => scheduleSync(300));
    scheduleSync(0);
  }
}

async function login(form, mode) {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || password.length < 6) { toast('Wpisz e-mail i hasło (co najmniej 6 znaków).'); return; }
  if (mode === 'up') {
    const result = await MamaCloud.signUp(email, password);
    if (result.needsConfirmation) {
      toast('Wysłałam e-mail z linkiem. Kliknij go, a potem zaloguj się tutaj.');
      return;
    }
  } else {
    await MamaCloud.signIn(email, password);
  }
  await refreshAccount();
  render();
  toast(S.family ? '✓ Zalogowano. Pobieram przepisy…' : '✓ Zalogowano. Wpisz kod albo zacznij nową książkę.');
}

async function logout() {
  const pending = (await store.all('recipes')).concat(await store.all('shop')).filter(x => x.dirty).length;
  const message = pending
    ? `Na tym telefonie są niewysłane zmiany (${pending}). Po wylogowaniu znikną. Wylogować mimo to?`
    : 'Wylogować? Przepisy zostaną zapisane i wrócą po ponownym zalogowaniu.';
  if (!(await ask(message, 'Wyloguj', pending > 0))) return;
  stopListening();
  await MamaCloud.signOut();
  await store.clearFamilyData();
  S.user = null; S.family = null; S.canRead = false;
  await loadData();
  render();
}

async function showShortcutToken() {
  const { token } = await MamaCloud.newShortcutToken();
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <h2>Skrót „Zapisz przepis”</h2>
    <p>Wklej te dwie rzeczy do skrótu według instrukcji. Poprzedni token skrótu przestał właśnie działać.</p>
    <label class="fieldlabel" for="sc-url">Adres</label><textarea id="sc-url" class="field" rows="3" readonly>${esc(MamaCloud.shortcutUrl())}</textarea>
    <button class="secondary" data-copy="sc-url">Kopiuj adres</button>
    <label class="fieldlabel" for="sc-token">Nagłówek Authorization</label><textarea id="sc-token" class="field" rows="3" readonly>Bearer ${esc(token)}</textarea>
    <button class="secondary" data-copy="sc-token">Kopiuj token</button>
    <p class="muted">Nie wysyłaj tokenu nikomu. Kto go ma, może dodawać przepisy do Waszej skrzynki.</p>
    <button class="primary" data-close>Gotowe</button>`;
  dialog.addEventListener('click', async e => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.copy) {
      try { await navigator.clipboard.writeText(dialog.querySelector('#' + button.dataset.copy).value); button.textContent = '✓ Skopiowano'; }
      catch { dialog.querySelector('#' + button.dataset.copy).select(); }
    }
    if (button.hasAttribute('data-close')) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* ---------- Kopia zapasowa ---------- */

async function exportBackup() {
  const recipes = (await store.all('recipes')).filter(r => !r.deleted);
  const images = {};
  for (const r of recipes) for (const hash of r.images) {
    try { await imageUrl(hash); images[hash] = await imageDataUrl(hash); } catch {}
  }
  const shop = (await store.all('shop')).filter(x => !x.deleted);
  const blob = new Blob([JSON.stringify({ app: 'przepisy-mamy', version: 2, recipes, shop, images })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `przepisy-mamy-kopia-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importBackup(file) {
  const json = JSON.parse(await file.text());
  if (json?.app !== 'przepisy-mamy' || !Array.isArray(json.recipes)) throw new Error('To nie jest kopia Przepisów Mamy.');
  const have = new Set(S.recipes.map(r => r.id));
  const fresh = json.recipes.filter(r => !have.has(r.id));
  if (!(await ask(`Dodać ${plural(fresh.length, 'przepis', 'przepisy', 'przepisów')} z kopii?`, 'Dodaj'))) return;
  for (const [hash, dataUrl] of Object.entries(json.images || {})) {
    if (!/^[a-f0-9]{64}$/.test(hash) || await store.get('images', hash)) continue;
    const blob = await (await fetch(dataUrl)).blob();
    await store.putImage({ hash, bytes: await blob.arrayBuffer(), type: blob.type, uploaded: false });
  }
  for (const r of fresh) await store.saveLocal('recipes', { ...validateRecipe(r), createdAt: r.createdAt });
  await loadData();
  render();
  toast('✓ Kopia przywrócona');
  scheduleSync();
}

/* ---------- Zdarzenia ---------- */

async function onClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled || b.closest('dialog')) return;
  const d = b.dataset;

  if (d.go) {
    if (S.screen === 'edit' && !(await ask('Wyjść bez zapisywania? Szkic zostanie zachowany.', 'Wyjdź'))) return;
    go(d.go);
    return;
  }
  if (d.recipe) { S.selected = d.recipe; go('detail'); return; }
  if (d.filter) { S.filter = S.filter === d.filter ? '' : d.filter; render(); return; }
  if (d.ingredient !== undefined) { await addToShopping([S.recipes.find(r => r.id === S.selected).ingredients[+d.ingredient]]); return; }
  if (d.rempic !== undefined) { readAddForm(); S.form.images.splice(+d.rempic, 1); saveDrafts(); render(); return; }
  if (d.append) {
    readEditor(); S.draft[d.append].push(''); saveDrafts(); render();
    const rows = document.querySelectorAll(`[data-edit="${d.append}"]`);
    rows[rows.length - 1]?.focus();
    return;
  }
  if (d.remove) { readEditor(); S.draft[d.remove].splice(+d.index, 1); saveDrafts(); render(); return; }
  if (d.tag) {
    readEditor();
    S.draft.tags = S.draft.tags.includes(d.tag) ? S.draft.tags.filter(t => t !== d.tag) : [...S.draft.tags, d.tag];
    b.classList.toggle('active'); b.setAttribute('aria-pressed', S.draft.tags.includes(d.tag));
    saveDrafts();
    return;
  }
  if (d.delshop) { await store.deleteLocal('shop', d.delshop); await loadData(); render(); scheduleSync(); return; }

  const recipe = S.recipes.find(r => r.id === S.selected);
  switch (d.action) {
    case 'new':
      if (S.draft?.isNew && !S.draft.inboxId) { go('edit'); toast('Wracasz do niezapisanego przepisu.'); } else go('add');
      break;
    case 'clear-filter': S.filter = ''; S.search = ''; render(); break;
    case 'pick': $('#files').click(); break;
    case 'read': await readRecipe(); break;
    case 'cancel-read': readAbort?.abort(); go('add'); break;
    case 'manual': readAddForm(); openEditor({ link: S.form.link, images: [...S.form.images] }); break;
    case 'edit': openEditor({ ...recipe, isNew: false, warnings: [] }); break;
    case 'cancel-edit':
      if (await ask('Wyjść bez zapisywania zmian?', 'Wyjdź')) {
        const wasNew = S.draft.isNew; S.draft = null; saveDrafts(); go(wasNew ? 'add' : 'detail');
      }
      break;
    case 'discard-inbox':
      if (await ask('Odrzucić ten przepis ze skrótu?', 'Odrzuć', true)) {
        await MamaCloud.remote.deleteInbox(S.draft.inboxId).catch(() => {});
        S.inbox = S.inbox.filter(x => x.id !== S.draft.inboxId);
        await store.setMeta('inbox', S.inbox);
        S.draft = null; saveDrafts(); go('recipes');
      }
      break;
    case 'inbox': openInbox(); break;
    case 'shop-all': await addToShopping(recipe.ingredients); break;
    case 'delete':
      if (await ask(`Usunąć przepis „${recipe.title}”?`, 'Usuń', true)) {
        await store.deleteLocal('recipes', recipe.id); await loadData(); go('recipes'); toast('Przepis usunięty'); scheduleSync();
      }
      break;
    case 'clear-bought':
      for (const item of S.shop.filter(x => x.done)) await store.deleteLocal('shop', item.id);
      await loadData(); render(); scheduleSync();
      break;
    case 'sync': S.syncStatus = 'Synchronizuję…'; render(); await synchronize(); render(); break;
    case 'shortcut': await showShortcutToken(); break;
    case 'create-family':
      if (await ask('Zacząć nową książkę przepisów? Druga osoba dołączy potem Twoim kodem z Ustawień.', 'Zacznij')) {
        await MamaCloud.createFamily('Przepisy Mamy'); await refreshAccount(); render(); toast('✓ Gotowe. Kod dla drugiej osoby znajdziesz w Ustawieniach.');
      }
      break;
    case 'logout': await logout(); break;
    case 'export': await exportBackup(); break;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const button = e.submitter || form.querySelector('button');
  if (button) button.disabled = true;
  try {
    if (form.id === 'editor') await saveRecipe();
    if (form.id === 'own') {
      const name = $('#own-name').value.trim();
      if (name) {
        await store.saveLocal('shop', { id: uid(), name: name.slice(0, 300), from: '', recipeId: null, done: false });
        await loadData(); render(); $('#own-name').focus(); toast('✓ Dodano do listy'); scheduleSync();
      }
    }
    if (form.id === 'login') await login(form, button?.dataset.mode);
    if (form.id === 'join') { await MamaCloud.joinFamily($('#code').value); await refreshAccount(); render(); toast('✓ Połączono. Pobieram przepisy…'); }
  } catch (error) {
    if (form.id === 'editor') { S.error = error.message; render(); } else toast(error.message);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function onChange(e) {
  const el = e.target;
  try {
    if (el.id === 'font') {
      S.font = Number(el.value);
      await store.setMeta('settings', { font: S.font });
    }
    if (el.dataset.check) {
      const item = S.shop.find(x => x.id === el.dataset.check);
      await store.saveLocal('shop', { ...item, done: el.checked });
      await loadData(); render();
      document.getElementById('shop-' + item.id)?.focus();
      scheduleSync();
    }
    if (el.id === 'files') {
      const files = [...el.files];
      if (S.form.images.length + files.length > 3) { toast('Najwyżej 3 zrzuty na jeden przepis.'); return; }
      readAddForm(); S.busy = true; render();
      try { for (const file of files) S.form.images.push(await addImage(file)); }
      finally { S.busy = false; saveDrafts(); render(); }
    }
    if (el.id === 'backup' && el.files[0]) await importBackup(el.files[0]);
  } catch (error) { toast(error.message); }
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'search') { S.search = el.value; $('#cards').innerHTML = MamaViews.recipeCards(S); showImages(); }
  if (el.id === 'font') {
    document.documentElement.style.setProperty('--scale', el.value);
    $('#font-output').textContent = Math.round(el.value * 100) + '%';
  }
  if (el.closest('#editor')) { readEditor(); saveDrafts(); }
  if (el.id === 'paste' || el.id === 'source') { readAddForm(); saveDrafts(); }
}

/* ---------- Start ---------- */

async function start() {
  try {
    store = await MamaStore.open();
    const drafts = await store.getMeta('drafts', {});
    if (drafts.form) S.form = drafts.form;
    if (drafts.draft) S.draft = drafts.draft;
    await loadData();
    render();
    await refreshAccount();
    render();
    MamaCloud.onAuthChange(event => { if (event === 'SIGNED_OUT' && S.user) { S.user = null; S.family = null; S.canRead = false; render(); } });
  } catch (error) {
    $('#main').innerHTML = `<h1>Nie mogę otworzyć danych</h1><p class="error">${esc(error.message)} Sprawdź, czy jest wolne miejsce na telefonie.</p><a class="primary" href="./">Spróbuj ponownie</a>`;
    return;
  }
  document.addEventListener('click', e => onClick(e).catch(error => toast(error.message)));
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(0); });
  setInterval(() => { if (document.visibilityState === 'visible') synchronize(); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}

start();
