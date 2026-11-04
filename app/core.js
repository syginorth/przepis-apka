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
  const INGREDIENTS_HEAD = /^(składniki|skladniki|potrzebujesz|potrzebne będą|potrzebne beda|lista składników)\b[^:]{0,40}:?\s*/i;
  const STEPS_HEAD = /^(przygotowanie|sposób przygotowania|sposob przygotowania|sposób wykonania|sposob wykonania|wykonanie|kroki|instrukcja|jak zrobić|jak zrobic|przepis krok po kroku)\b[^:]{0,40}:?\s*/i;
  const UNIT = /(?<!\p{L})((\d+([,.]\d+)?|½|¼|¾|pół|pol)\s*(g|gr|dag|kg|ml|l|szt|sztuk[aiy]?)(?!\p{L})|(szklan|łyżk|lyzk|łyżecz|lyzecz|szczypt|opakowa|ząb|zab|garść|garsc|kostk|puszk|plaster|pęczek|peczek))/iu;
  // Napisy z interfejsu Facebooka i śmieci po odczycie zrzutu.
  const NOISE = /^(lubię to|lubie to|komentarz|udostępnij|udostepnij|wyślij|wyslij|obserwuj|zobacz więcej|zobacz wiecej|… więcej|\.\.\. więcej|reels?|rolki|odtwórz|sponsorowane|\d+\s*(tys\.?|mln)?\s*(wyświetleń|komentarzy|udostępnień|reakcji))\b/i;

  const cleanLine = line => line
    .replace(/^[\s\-–•*·●○▪►✓✔✅☑️👉🔸🔹⭐️🌟]+/u, '')
    // Ikonki (✅, •) odczytane ze zrzutu jako „V.”, „[V.”, „|”.
    .replace(/^(?:[|\[\]{}()<>«»©®@*~=+_\/\\]+\s*|[vVyY][.\/|,]?\s+(?=\d)|[vVyY][.\/|,]\s*)+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const isNoise = line => {
    const letters = (line.match(/\p{L}/gu) || []).length;
    return line.length < 2 || letters < 2 || letters / line.length < 0.4 || NOISE.test(line) || /^#\S+(\s+#\S+)*$/.test(line);
  };

  /** Porządkuje wklejony opis albo tekst odczytany ze zrzutu na składniki i kroki (bez AI). */
  function parseText(text) {
    const source = String(text || '');
    const all = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let title = '';
    let section = '';
    let minutes = 0;
    const ingredients = [], steps = [], other = [];
    for (const raw of all) {
      let line = cleanLine(raw);
      const time = /(czas( przygotowania| pieczenia)?|⏱️?)\s*:?\s*(ok\.?\s*)?(\d+)\s*(min|godz|h)/i.exec(raw);
      if (time && !minutes) {
        minutes = Number(time[4]) * (/godz|h/i.test(time[5]) ? 60 : 1);
        if (/^(czas|⏱)/i.test(raw.trim())) continue;
      }
      let head = INGREDIENTS_HEAD.exec(line);
      if (head) { section = 'ingredients'; line = line.slice(head[0].length).trim(); }
      else if ((head = STEPS_HEAD.exec(line))) { section = 'steps'; line = line.slice(head[0].length).trim(); }
      if (!line || isNoise(line)) continue;
      line = line.replace(/^tytuł\s*:\s*/i, '');
      if (!title && !section) { title = line.slice(0, 200); continue; }
      if (section === 'ingredients') {
        // „mąka, cukier, jajka” w jednej linii po nagłówku dzielimy na osobne składniki.
        const parts = head && line.includes(',') ? line.split(/,\s*/) : [line];
        ingredients.push(...parts.filter(Boolean));
      } else if (section === 'steps') steps.push(line);
      else if (UNIT.test(line) && line.length < 90) ingredients.push(line);
      else other.push(line);
    }
    // Odczyt zrzutu łamie zdania na kilka linii: sklejamy, gdy następna zaczyna się małą literą.
    const merged = [];
    for (const line of [...steps, ...other]) {
      const last = merged[merged.length - 1];
      if (last && !/[.!?:]$/.test(last) && /^\p{Ll}/u.test(line)) merged[merged.length - 1] = `${last} ${line}`;
      else merged.push(line);
    }
    if (!title || (!ingredients.length && !merged.length)) throw new Error('Opis jest zbyt krótki. Dodaj tytuł, składniki i sposób przygotowania albo wpisz przepis ręcznie.');
    return { title, minutes, minutesEstimated: false, ingredients, steps: merged, tags: guessTags(source, minutes) };
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
