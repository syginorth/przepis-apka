# Przepisy Mamy

Aplikacja na telefon (PWA) z przepisami i wspólną listą zakupów. Zrzuty ekranu rolek z Facebooka odczytuje Gemini.

## Jak to jest zbudowane

| Plik | Co robi |
| --- | --- |
| `app/index.html`, `style.css` | Wygląd (kremowo-zielony, duża czcionka z suwakiem 100–145%) |
| `app/views.js` | Ekrany: lista, dodawanie, odczyt, szczegóły, edycja, zakupy, ustawienia |
| `app/app.js` | Zdarzenia, zapis, logowanie, synchronizacja |
| `app/store.js` | Dane na telefonie (IndexedDB), działa offline |
| `app/sync.js` | Wysyła tylko zmienione przepisy i pozycje; zdjęcie wysyłane raz |
| `app/cloud.js` | Supabase: konto, rodzina, baza, zdjęcia, zmiany na żywo |
| `app/config.js` | Adres i publiczny klucz projektu Supabase |
| `supabase/migrations/` | Baza: rodziny, przepisy, zakupy, skrzynka skrótu, zdjęcia |
| `supabase/functions/przepis/` | Odczyt przepisu przez Gemini (aplikacja i skrót iOS) |
| `SKROT-IOS.md` | Jak złożyć skrót „Zapisz przepis” na iPhonie |

Bez konfiguracji Supabase aplikacja działa tylko na jednym telefonie (wklejony opis porządkuje lokalnie).

## Konflikty

Gdy dwie osoby zmienią ten sam przepis jednocześnie, zostają obie wersje („… (druga wersja)”). Usunięcie nie kasuje przepisu, który ktoś w tym czasie zmienił. Lista zakupów: wygrywa ostatnia zmiana.

## Uruchomienie u siebie

```sh
npm install
npm test          # testy synchronizacji i odczytu
npm run serve     # http://127.0.0.1:8000
```

## Podłączenie Supabase

1. Uruchom `supabase/migrations/20261104000001_przepisy.sql` (SQL Editor albo `supabase db push`).
2. Wgraj funkcję: `supabase functions deploy przepis` (w `config.toml` jest `verify_jwt = false`, bo skrót ma własny token; funkcja sama sprawdza sesję).
3. W Edge Functions → Secrets ustaw `GEMINI_API_KEY` (z Google AI Studio). Opcjonalnie `GEMINI_MODEL` (domyślnie `gemini-3.8-flash`).
4. W `app/config.js` wpisz adres projektu i klucz publiczny (publishable/anon).
5. Authentication → URL Configuration: Site URL = adres aplikacji.
6. W aplikacji: pierwsza osoba zakłada konto i „Załóż nową rodzinę”, druga zakłada konto i dołącza kodem z Ustawień.

Po każdej zmianie plików w `app/` podnieś numer `CACHE` w `app/sw.js`.
