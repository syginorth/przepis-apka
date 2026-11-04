/* Czyste funkcje: kategorie, porządkowanie wklejonego tekstu, sprawdzanie przepisu. */
(function (root) {
  'use strict';

  const CATEGORIES = ['Kurczak', 'Wołowina', 'Wieprzowina', 'Ryba', 'Wege', 'Zupy', 'Ciasta i desery', 'Do 30 min'];
  const BACKGROUNDS = ['t1', 't2', 't3'];

  function safeLink(value) {
    try {
      const url = new URL(String(value || '').trim());
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  /** Proste tagi z tekstu, gdy nie ma AI (tryb bez konta). */
  function guessTags(text, minutes) {
    const t = text.toLocaleLowerCase('pl');
    const tags = [];
    if (/kurcz|indyk/.test(t)) tags.push('Kurczak');
    if (/wołow|wolow/.test(t)) tags.push('Wołowina');
    if (/wieprz|schab|boczek|szynk/.test(t)) tags.push('Wieprzowina');
    if (/ryb|łoso|loso|dorsz|tuńczy|tunczy/.test(t)) tags.push('Ryba');
    if (/zup|krem z|bulion/.test(t)) tags.push('Zupy');
    if (/ciast|sernik|deser|herbatnik/.test(t)) tags.push('Ciasta i desery');
    if (/\bwege\b|wegetaria|wegań/.test(t)) tags.push('Wege');
    return withTimeTag(tags, minutes);
  }

  /** „Do 30 min” zależy wyłącznie od czasu. */
  function withTimeTag(tags, minutes) {
    const result = [...new Set(tags.filter(tag => CATEGORIES.includes(tag) && tag !== 'Do 30 min'))];
    if (minutes > 0 && minutes <= 30) result.push('Do 30 min');
    return result;
  }

  /** Porządkuje wklejony opis według nagłówków „Składniki” i „Przygotowanie”. */
  function parseText(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('Opis jest zbyt krótki. Dodaj tytuł, składniki i sposób przygotowania albo wpisz przepis ręcznie.');
    const title = lines.shift().replace(/^tytuł\s*:\s*/i, '').slice(0, 200);
    let section = '';
    let minutes = 0;
    const ingredients = [], steps = [], other = [];
    for (const raw of lines) {
      const line = raw.replace(/^[-•*]\s*|^\d+[.)]\s*/, '').trim();
      if (/^(składniki|skladniki)\s*:?$/i.test(line)) { section = 'ingredients'; continue; }
      if (/^(przygotowanie|sposób przygotowania|sposob przygotowania|wykonanie|kroki)\s*:?$/i.test(line)) { section = 'steps'; continue; }
      const time = /^(czas|czas przygotowania)\s*:.*?(\d+)\s*(min|godz|h)/i.exec(line);
      if (time) { minutes = Number(time[2]) * (/godz|h/i.test(time[3]) ? 60 : 1); continue; }
      if (section === 'ingredients') ingredients.push(line);
      else if (section === 'steps') steps.push(line);
      else other.push(line);
    }
    steps.push(...other);
    return { title, minutes, minutesEstimated: false, ingredients, steps, tags: guessTags(text, minutes) };
  }

  const lines = (value, maxLength) => (Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'string' && item.trim())
    .slice(0, 200)
    .map(item => item.trim().slice(0, maxLength));

  /** Sprawdza przepis przed zapisem. Rzuca błąd z polskim komunikatem. */
  function validateRecipe(input) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw new Error('Wpisz tytuł przepisu.');
    if (title.length > 200) throw new Error('Tytuł jest za długi.');
    const ingredients = lines(input.ingredients, 500);
    const steps = lines(input.steps, 3000);
    if (!ingredients.length && !steps.length) throw new Error('Dodaj przynajmniej jeden składnik albo krok.');
    const minutes = Math.round(Number(input.minutes) || 0);
    if (minutes < 0 || minutes > 10080) throw new Error('Czas musi wynosić od 0 do 10080 minut.');
    return {
      id: typeof input.id === 'string' && input.id ? input.id : crypto.randomUUID(),
      title,
      minutes,
      minutesEstimated: minutes > 0 && input.minutesEstimated === true,
      ingredients,
      steps,
      tags: withTimeTag(Array.isArray(input.tags) ? input.tags : [], minutes),
      link: safeLink(input.link),
      images: (Array.isArray(input.images) ? input.images : []).filter(hash => /^[a-f0-9]{64}$/.test(hash)).slice(0, 10),
      emoji: typeof input.emoji === 'string' && input.emoji ? input.emoji.slice(0, 8) : '🍽️',
      bg: BACKGROUNDS.includes(input.bg) ? input.bg : BACKGROUNDS[Math.floor(Math.random() * 3)]
    };
  }

  /** Polska odmiana: 1 przepis, 2 przepisy, 5 przepisów. */
  function plural(n, one, few, many) {
    if (n === 1) return `${n} ${one}`;
    const last = n % 10, lastTwo = n % 100;
    return `${n} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many}`;
  }

  root.MamaCore = { CATEGORIES, safeLink, guessTags, withTimeTag, parseText, validateRecipe, plural };
})(globalThis);
