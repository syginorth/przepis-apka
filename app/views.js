/* Ekrany aplikacji jako szablony HTML. Każda funkcja dostaje stan i zwraca tekst. */
(function (root) {
  'use strict';

  const { CATEGORIES, safeLink, plural } = root.MamaCore;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const header = (title, eyebrow) => `
    <header class="head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div><span class="round" aria-hidden="true">🍃</span></header>`;
  const back = (target = 'recipes', label = '‹ Wszystkie przepisy') => `<button class="back" data-go="${target}">${label}</button>`;
  const tags = list => `<div class="tags">${list.map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}</div>`;
  const time = (r, long) => r.minutes ? `${r.minutes} ${long ? 'minut' : 'min'}${r.minutesEstimated ? ' (około)' : ''}` : 'Czas niepodany';

  // Zdjęcie wstawiane jest po wyrenderowaniu (data-img), bo może wymagać pobrania.
  const thumb = (r, big = false) => `
    <div class="thumb ${esc(r.bg || 't2')} ${big ? 'big' : ''}" ${r.images?.[0] ? `data-img="${esc(r.images[0])}" data-alt="Zdjęcie: ${esc(r.title)}"` : ''}>
      <span aria-hidden="true">${esc(r.emoji || '🍽️')}</span>
    </div>`;

  function visibleRecipes(S) {
    const q = S.search.toLocaleLowerCase('pl').trim();
    return S.recipes.filter(r =>
      (!S.filter || r.tags.includes(S.filter)) &&
      (!q || [r.title, ...r.ingredients, ...r.tags].join(' ').toLocaleLowerCase('pl').includes(q)));
  }

  function recipeCards(S) {
    const shown = visibleRecipes(S);
    const head = `<div class="listhead"><h3>${S.filter || S.search ? 'Wybrane przepisy' : 'Ostatnio dodane'}</h3><small>${plural(shown.length, 'przepis', 'przepisy', 'przepisów')}</small></div>`;
    if (shown.length) {
      return head + shown.map(r => `
        <button class="recipe" data-recipe="${esc(r.id)}">
          ${thumb(r)}
          <span class="recipe-text"><strong>${esc(r.title)}</strong><span class="meta">◷ ${time(r)}</span>${tags(r.tags)}</span>
          <span aria-hidden="true">›</span>
        </button>`).join('');
    }
    const any = S.recipes.length > 0;
    return head + `
      <div class="empty">
        <div class="art" aria-hidden="true">${any ? '🔍' : '📖'}</div>
        <h2>${any ? 'Nie znaleziono przepisów' : 'Tu zamieszkają Twoje przepisy'}</h2>
        <p>${any ? 'Spróbuj innego słowa lub kategorii.' : 'Dodaj pierwszy przepis ze zrzutów ekranu, z opisu albo wpisz go ręcznie.'}</p>
        ${any ? '<button class="secondary" data-action="clear-filter">Pokaż wszystkie</button>' : ''}
      </div>`;
  }

  function inboxBanner(S) {
    if (!S.inbox.length) return '';
    return `<button class="choice inbox" data-action="inbox">📥 ${plural(S.inbox.length, 'nowy przepis', 'nowe przepisy', 'nowych przepisów')} ze skrótu<span>Naciśnij, żeby sprawdzić i zapisać.</span></button>`;
  }

  const list = S => `
    ${header('Przepisy Mamy', 'SMACZNIE JAK W DOMU')}
    ${inboxBanner(S)}
    <label class="sr-only" for="search">Szukaj przepisu lub składnika</label>
    <input class="search" id="search" type="search" placeholder="Szukaj przepisu…" value="${esc(S.search)}" autocomplete="off">
    <div class="chips" role="group" aria-label="Kategorie">
      ${CATEGORIES.map(c => `<button class="chip ${S.filter === c ? 'active' : ''}" data-filter="${esc(c)}" aria-pressed="${S.filter === c}">${esc(c)}</button>`).join('')}
    </div>
    <button class="primary" data-action="new">＋ Dodaj przepis</button>
    <div id="cards">${recipeCards(S)}</div>`;

  function detail(S) {
    const r = S.recipes.find(x => x.id === S.selected);
    if (!r) return list(S);
    const link = safeLink(r.link);
    return `
      ${back()}
      ${thumb(r, true)}
      <h1>${esc(r.title)}</h1>
      <div class="meta">◷ ${time(r, true)} · ${plural(r.ingredients.length, 'składnik', 'składniki', 'składników')}</div>
      ${tags(r.tags)}
      ${link ? `<a class="secondary" style="margin-top:18px" href="${esc(link)}" target="_blank" rel="noopener noreferrer">▶ Obejrzyj rolkę</a>` : ''}
      ${r.ingredients.length ? `
      <section class="card">
        <div class="listhead" style="margin-top:0"><h2>🥕 Składniki</h2><button class="small" data-action="shop-all">＋ Dodaj wszystkie</button></div>
        ${r.ingredients.map((t, i) => `<div class="ingredient"><span>${esc(t)}</span><button class="small" data-ingredient="${i}" aria-label="Dodaj ${esc(t)} do zakupów">＋</button></div>`).join('')}
      </section>` : ''}
      ${r.steps.length ? `
      <section class="card">
        <h2>👩‍🍳 Przygotowanie</h2>
        <ol style="list-style:none;padding:0">
          ${r.steps.map((s, i) => `<li class="step"><span class="num" aria-hidden="true">${i + 1}</span><p><span class="sr-only">Krok ${i + 1}. </span>${esc(s)}</p></li>`).join('')}
        </ol>
      </section>` : ''}
      ${r.images.length > 1 ? `
      <details class="card"><summary>Pokaż wszystkie zrzuty (${r.images.length})</summary>
        ${r.images.map((hash, i) => `<div class="shot" data-img="${esc(hash)}" data-alt="Zrzut ${i + 1}"></div>`).join('')}
      </details>` : ''}
      <div class="actions">
        <button class="secondary" data-action="edit">✎ Edytuj przepis</button>
        <button class="danger" data-action="delete">Usuń przepis</button>
      </div>`;
  }

  function add(S) {
    const f = S.form;
    return `
      ${back()}
      <h1>Dodaj przepis</h1>
      <p class="muted">Zachowaj coś pysznego na później.</p>
      <button class="choice" data-action="pick">🖼️ Wybierz zrzuty ekranu<span>Możesz zaznaczyć kilka naraz (najwyżej 3). Wszystkie złożą się na jeden przepis.</span></button>
      <input id="files" class="sr-only" tabindex="-1" type="file" accept="image/*" multiple>
      <div class="previews">
        ${f.images.map((hash, i) => `<div class="pic"><div class="shot small-shot" data-img="${esc(hash)}" data-alt="Zrzut ${i + 1}"></div><button class="small" data-rempic="${i}">Usuń ${i + 1}</button></div>`).join('')}
      </div>
      <label class="fieldlabel" for="paste">albo wklej skopiowany opis</label>
      <textarea class="field" id="paste" rows="6" placeholder="Wklej tutaj treść przepisu z Facebooka…">${esc(f.text)}</textarea>
      <label class="fieldlabel" for="source">Link do rolki (opcjonalnie)</label>
      <input class="field" id="source" type="url" inputmode="url" value="${esc(f.link)}" placeholder="https://facebook.com/…">
      <div class="note">${S.canRead
        ? 'Po naciśnięciu „Odczytaj przepis” zrzuty i opis trafią do Google Gemini, które ułoży składniki i kroki. Zawsze sprawdź wynik przed zapisaniem.'
        : 'Odczyt zrzutów działa po zalogowaniu (Ustawienia). Wklejony opis uporządkuję na telefonie według nagłówków „Składniki” i „Przygotowanie”.'}</div>
      ${S.error ? `<p class="error" role="alert">${esc(S.error)}</p>` : ''}
      <button class="primary" data-action="read" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Przygotowuję zdjęcia…' : 'Odczytaj przepis'}</button>
      <button class="secondary" style="margin-top:12px" data-action="manual" ${S.busy ? 'disabled' : ''}>Wpisz przepis ręcznie</button>`;
  }

  const loading = () => `
    <div class="empty" aria-live="polite">
      <div class="art" aria-hidden="true">📖</div><div class="spinner" aria-hidden="true"></div>
      <h1>Czytam przepis…</h1><p>Układam składniki i kroki. To potrwa kilka sekund.</p>
      <button class="secondary" data-action="cancel-read">Anuluj</button>
    </div>`;

  function editRows(d, key, label, addLabel) {
    return `
      <h2>${label}</h2>
      ${d[key].map((text, i) => `
        <div class="editrow">
          <label class="sr-only" for="${key}-${i}">${label} ${i + 1}</label>
          <textarea class="field" rows="2" id="${key}-${i}" data-edit="${key}" data-index="${i}">${esc(text)}</textarea>
          <button type="button" class="small" data-remove="${key}" data-index="${i}" aria-label="Usuń: ${label.toLowerCase()} ${i + 1}">×</button>
        </div>`).join('')}
      <button type="button" class="secondary" data-append="${key}">＋ ${addLabel}</button>`;
  }

  function edit(S) {
    const d = S.draft;
    return `
      <button class="back" data-action="cancel-edit">‹ Anuluj</button>
      <h1>${d.isNew ? 'Sprawdź i zapisz' : 'Edytuj przepis'}</h1>
      <p class="muted">Sprawdź tytuł, składniki i sposób przygotowania.</p>
      ${(d.warnings || []).map(w => `<p class="note">⚠️ ${esc(w)}</p>`).join('')}
      <form id="editor" novalidate>
        <label class="fieldlabel" for="title">Tytuł</label>
        <input class="field" id="title" required maxlength="200" value="${esc(d.title)}">
        <label class="fieldlabel" for="minutes">Czas przygotowania w minutach</label>
        <input class="field" id="minutes" type="number" inputmode="numeric" min="0" max="10080" value="${d.minutes || ''}" placeholder="np. 30">
        <section class="card">${editRows(d, 'ingredients', 'Składniki', 'Dodaj składnik')}</section>
        <section class="card">${editRows(d, 'steps', 'Kroki', 'Dodaj krok')}</section>
        <h2>Kategorie</h2>
        <div class="chips wrap" role="group" aria-label="Kategorie">
          ${CATEGORIES.filter(c => c !== 'Do 30 min').map(c => `<button type="button" class="chip ${d.tags.includes(c) ? 'active' : ''}" data-tag="${esc(c)}" aria-pressed="${d.tags.includes(c)}">${esc(c)}</button>`).join('')}
        </div>
        <p class="muted">„Do 30 min” ustawia się samo według czasu.</p>
        <label class="fieldlabel" for="edit-link">Link do rolki (opcjonalnie)</label>
        <input class="field" id="edit-link" type="url" inputmode="url" value="${esc(d.link)}">
        ${S.error ? `<p class="error" role="alert">${esc(S.error)}</p>` : ''}
        <button class="primary" type="submit" style="margin-top:20px">Zapisz przepis</button>
        ${d.inboxId ? '<button class="secondary" type="button" style="margin-top:12px" data-action="discard-inbox">Odrzuć ten przepis</button>' : ''}
      </form>`;
  }

  function shop(S) {
    const sorted = [...S.shop].sort((a, b) => Number(a.done) - Number(b.done));
    return `
      ${header('Lista zakupów', 'WSZYSTKO W JEDNYM MIEJSCU')}
      <p class="muted">${S.family ? 'Wspólna lista: zmiany widać na obu telefonach.' : 'Wszystko, czego potrzebujesz do gotowania.'}</p>
      <section class="card">
        ${sorted.length ? sorted.map(x => `
          <div class="shoprow ${x.done ? 'done' : ''}">
            <input id="shop-${esc(x.id)}" type="checkbox" data-check="${esc(x.id)}" ${x.done ? 'checked' : ''}>
            <label for="shop-${esc(x.id)}"><span class="shopname">${esc(x.name)}</span><small>${esc(x.from || 'Własna pozycja')}</small></label>
            <button class="small" data-delshop="${esc(x.id)}" aria-label="Usuń ${esc(x.name)} z listy">×</button>
          </div>`).join('') : `
          <div class="empty"><div class="art" aria-hidden="true">🧺</div><h2>Lista jest pusta</h2><p>Dodaj składniki z przepisu albo własną pozycję.</p></div>`}
      </section>
      <form id="own">
        <label class="fieldlabel" for="own-name">Dodaj własną pozycję</label>
        <input id="own-name" class="field" required maxlength="300" placeholder="Na przykład: mleko" autocomplete="off">
        <button class="primary" style="margin-top:12px">＋ Dodaj do listy</button>
      </form>
      ${S.shop.some(x => x.done) ? '<button class="secondary" style="margin-top:12px" data-action="clear-bought">Wyczyść kupione</button>' : ''}`;
  }

  function account(S) {
    if (!S.cloudConfigured) return '';
    if (!S.user) {
      return `
        <section class="card">
          <h2>Logowanie</h2>
          <p>Zaloguj się, żeby przepisy i lista zakupów były wspólne na obu telefonach, a zrzuty odczytywały się same.</p>
          <form id="login">
            <label class="fieldlabel" for="email">E-mail</label>
            <input id="email" class="field" type="email" autocomplete="username" required>
            <label class="fieldlabel" for="password">Hasło</label>
            <input id="password" class="field" type="password" autocomplete="current-password" minlength="6" required>
            <button class="primary" style="margin-top:16px" data-mode="in">Zaloguj się</button>
            <button class="secondary" style="margin-top:12px" data-mode="up">Załóż nowe konto</button>
          </form>
        </section>`;
    }
    if (!S.family) {
      return `
        <section class="card">
          <h2>Logowanie</h2>
          <p>Zalogowano jako ${esc(S.user.email)}. Jeśli druga osoba już korzysta z aplikacji, wpisz kod z jej Ustawień, żeby mieć te same przepisy.</p>
          <form id="join">
            <label class="fieldlabel" for="code">Kod</label>
            <input id="code" class="field" autocomplete="off" autocapitalize="characters" maxlength="6" required placeholder="np. A1B2C3">
            <button class="primary" style="margin-top:12px">Dołącz</button>
          </form>
          <button class="secondary" style="margin-top:12px" data-action="create-family">Jestem pierwsza — zacznij nową książkę</button>
          <button class="back" data-action="logout">Wyloguj</button>
        </section>`;
    }
    return `
      <section class="card">
        <h2>Logowanie</h2>
        <p>Zalogowano jako ${esc(S.user.email)}.<br>${S.syncStatus}</p>
        <p class="muted">Kod dla drugiej osoby: <strong style="letter-spacing:2px">${esc(S.family.join_code)}</strong></p>
        <button class="secondary" data-action="sync">Synchronizuj teraz</button>
        <button class="secondary" style="margin-top:12px" data-action="shortcut">📲 Połącz skrót „Zapisz przepis”</button>
        <button class="back" data-action="logout">Wyloguj</button>
      </section>`;
  }

  const settings = S => `
    ${header('Ustawienia', 'TAK JAK LUBISZ')}
    <section class="card">
      <h2>Wielkość tekstu</h2>
      <p>Dopasuj litery, żeby wygodnie czytać przepisy.</p>
      <label for="font">Rozmiar: <output id="font-output">${Math.round(S.font * 100)}%</output></label>
      <input id="font" type="range" min="1" max="1.45" step="0.05" value="${S.font}">
      <div class="note"><strong>Tak będzie wyglądać tekst</strong><p>Dodaj dwa ząbki czosnku i dobrze wymieszaj.</p></div>
    </section>
    ${account(S)}
    <section class="card">
      <h2>📲 Zainstaluj na iPhonie</h2>
      <ol>
        <li>Otwórz tę stronę w Safari.</li>
        <li>Naciśnij „Udostępnij” (kwadrat ze strzałką w górę).</li>
        <li>Wybierz „Do ekranu początkowego” i potwierdź „Dodaj”.</li>
        <li>Uruchamiaj „Przepisy Mamy” z nowej ikonki.</li>
      </ol>
    </section>
    <section class="card">
      <h2>Kopia zapasowa</h2>
      <p>Plik z wszystkimi przepisami i zdjęciami, na wszelki wypadek.</p>
      <button class="secondary" data-action="export">Pobierz kopię</button>
      <label class="fieldlabel" for="backup">Przywróć z kopii (doda brakujące przepisy)</label>
      <input class="field" id="backup" type="file" accept="application/json,.json">
    </section>`;

  function render(S) {
    const screens = { recipes: list, detail, add, loading, edit, shop, settings };
    return (screens[S.screen] || list)(S);
  }

  function nav(S) {
    const current = ['add', 'detail', 'edit', 'loading'].includes(S.screen) ? 'recipes' : S.screen;
    return [['recipes', '📖', 'Przepisy'], ['shop', '🛒', 'Lista zakupów'], ['settings', '⚙️', 'Ustawienia']]
      .map(([screen, icon, label]) => `<button data-go="${screen}" ${current === screen ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</button>`)
      .join('');
  }

  root.MamaViews = { esc, render, nav, recipeCards };
})(globalThis);
