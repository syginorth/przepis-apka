// Funkcja serwerowa „przepis”.
//   POST /przepis/read      (zalogowana) zrzuty/opis -> szkic przepisu z Gemini
//   POST /przepis/token     (zalogowana) nowy token dla skrótu iOS (stary przestaje działać)
//   POST /przepis/shortcut  (token skrótu) zrzuty/opis -> szkic trafia do skrzynki w aplikacji
// Klucz Gemini jest tylko tutaj, w sekretach Supabase (GEMINI_API_KEY).

import { PROMPT, SCHEMA, base64, checkSources, cleanDraft, dataUrlToBytes, sha256 } from './recipe.mjs';

const env = (name: string) => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const MODEL = env('GEMINI_MODEL') || 'gemini-3.8-flash';
const GEMINI_BASE = env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com'; // zmiana tylko do testów

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  unauthorized: 'Zaloguj się ponownie.',
  bad_token: 'Skrót nie jest połączony. Otwórz Przepisy Mamy → Ustawienia → Połącz skrót.',
  no_family: 'Konto nie należy jeszcze do rodziny.',
  link_only: 'Sam link nie wystarczy, bo Facebook nie pozwala odczytać rolki. Zrób zrzuty ekranu z przepisem albo skopiuj opis.',
  empty: 'Dodaj zrzuty ekranu albo wklej opis przepisu.',
  too_many_images: 'Najwyżej 3 zrzuty naraz.',
  image_too_large: 'Zdjęcie jest za duże.',
  invalid_image: 'Tego pliku nie da się odczytać. Wybierz zrzut ekranu.',
  text_too_long: 'Opis jest za długi.',
  not_configured: 'Odczyt nie jest jeszcze skonfigurowany (brak klucza Gemini).',
  provider_limit: 'Dzienny darmowy limit odczytów się wyczerpał. Spróbuj jutro albo wpisz przepis ręcznie.',
  provider_error: 'Nie udało się odczytać przepisu. Spróbuj ponownie za chwilę.',
  invalid_request: 'Niepoprawne zapytanie.'
};

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // Nowe klucze (sb_secret_…) idą tylko w apikey; stare klucze JWT także jako Bearer.
  const headers: Record<string, string> = { apikey: SERVICE_KEY, ...extra };
  if (!SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers as Record<string, string> ?? {}) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`db ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function householdOf(userId: string) {
  const rows = await db(`household_members?user_id=eq.${userId}&select=household_id`);
  if (rows.length !== 1) throw new HttpError(403, 'no_family');
  return rows[0].household_id as string;
}

async function userFromSession(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthorized');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new HttpError(401, 'unauthorized');
  const user = await response.json();
  return { id: user.id as string, household: await householdOf(user.id) };
}

async function userFromShortcutToken(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length < 20) throw new HttpError(401, 'bad_token');
  const hash = await sha256(new TextEncoder().encode(token));
  const rows = await db(`shortcut_tokens?token_hash=eq.${hash}&select=user_id`);
  if (rows.length !== 1) throw new HttpError(401, 'bad_token');
  return { id: rows[0].user_id as string, household: await householdOf(rows[0].user_id) };
}

async function askGemini(text: string, images: { bytes: Uint8Array; mimeType: string }[]) {
  const key = env('GEMINI_API_KEY');
  if (!key) throw new HttpError(503, 'not_configured');
  const parts = [
    { text: text ? `Opis z Facebooka:\n${text}` : 'Odczytaj przepis z załączonych zrzutów ekranu.' },
    ...images.map(image => ({ inlineData: { mimeType: image.mimeType, data: base64(image.bytes) } }))
  ];
  const call = (withSchema: boolean) => fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', ...(withSchema ? { responseJsonSchema: SCHEMA } : {}), maxOutputTokens: 32768 }
    }),
    signal: AbortSignal.timeout(120000)
  });
  let response = await call(true);
  // Gdyby model nie przyjął schematu, próbujemy samego JSON-a (wynik i tak jest czyszczony).
  if (response.status === 400) response = await call(false);
  if (response.status === 429) throw new HttpError(429, 'provider_limit');
  if (!response.ok) {
    console.error('gemini', response.status, (await response.text()).slice(0, 500));
    throw new HttpError(502, 'provider_error');
  }
  const answer = await response.json();
  const output = (answer.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string; thought?: boolean }) => part.thought ? '' : part.text ?? '').join('');
  try {
    return cleanDraft(JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, '')));
  } catch {
    throw new HttpError(502, 'provider_error');
  }
}

async function readShortcutBody(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const images: Uint8Array[] = [];
    let text = '', link = '';
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value.trim()) && !link) link = value.trim();
        else if (name !== 'link') text += (text ? '\n' : '') + value;
        else link = value.trim();
      } else {
        images.push(new Uint8Array(await value.arrayBuffer()));
      }
    }
    return { text, link, images };
  }
  const body = await request.json();
  return { text: body.text ?? '', link: body.link ?? '', images: (body.images ?? []).map(dataUrlToBytes) };
}

async function uploadImage(household: string, image: { bytes: Uint8Array; mimeType: string }) {
  const hash = await sha256(image.bytes);
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/recipe-images/${household}/${hash}`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': image.mimeType, 'x-upsert': 'true' }),
    body: new Blob([image.bytes as BlobPart], { type: image.mimeType })
  });
  if (!response.ok) throw new Error(`storage ${response.status}`);
  return hash;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = new URL(request.url).pathname.replace(/^.*\/przepis/, '') || '/';
  const isShortcut = route === '/shortcut';
  const reply = (body: unknown, status = 200) => isShortcut
    ? new Response(String(body), { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } })
    : new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    if (request.method !== 'POST') throw new HttpError(405, 'invalid_request');

    if (route === '/read') {
      await userFromSession(request);
      const body = await request.json();
      const sources = checkSources({ text: body.text ?? '', link: body.link ?? '', images: (body.images ?? []).map(dataUrlToBytes) });
      const draft = await askGemini(sources.text, sources.images);
      return reply({ draft, link: sources.link });
    }

    if (route === '/token') {
      const user = await userFromSession(request);
      const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
      await db('shortcut_tokens?on_conflict=user_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: user.id, token_hash: await sha256(new TextEncoder().encode(token)), created_at: new Date().toISOString() })
      });
      return reply({ token });
    }

    if (isShortcut) {
      const user = await userFromShortcutToken(request);
      const sources = checkSources(await readShortcutBody(request));
      const draft = await askGemini(sources.text, sources.images);
      const images: string[] = [];
      for (const image of sources.images) {
        const hash = await uploadImage(user.household, image);
        if (!images.includes(hash)) images.push(hash);
      }
      await db('inbox', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ household_id: user.household, created_by: user.id, draft, link: sources.link, images })
      });
      const title = draft.title || 'Nowy przepis';
      return reply(`Zapisano „${title}”. Otwórz Przepisy Mamy, żeby sprawdzić i zapisać.`, 200);
    }

    throw new HttpError(404, 'invalid_request');
  } catch (error) {
    const code = error instanceof HttpError ? error.message : error instanceof Error && MESSAGES[error.message] ? error.message : 'provider_error';
    const status = error instanceof HttpError ? error.status : MESSAGES[(error as Error)?.message] ? 400 : 500;
    if (status >= 500) console.error(error);
    const message = MESSAGES[code] ?? MESSAGES.provider_error;
    // Skrót pokazuje odpowiedź jako tekst, więc dla niego zawsze 200.
    return isShortcut ? reply(message, 200) : reply({ code, message }, status);
  }
});
