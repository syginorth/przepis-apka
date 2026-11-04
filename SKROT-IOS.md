# Skrót „Zapisz przepis” (iPhone mamy)

Dzięki niemu mama robi zrzuty ekranu rolki, zaznacza je w Zdjęciach, naciska **Udostępnij → Zapisz przepis** i gotowe. Przepis czeka potem w aplikacji na górze listy („📥 nowy przepis ze skrótu”), do sprawdzenia i zapisania.

Apple nie pozwala zainstalować skrótu z pliku, więc trzeba go raz złożyć na telefonie mamy. To ok. 5 minut.

## 1. Skopiuj adres i token

W aplikacji Przepisy Mamy (zalogowanej na koncie mamy): **Ustawienia → Połącz skrót „Zapisz przepis”**. Zobaczysz dwa pola z przyciskami „Kopiuj”. Zostaw to okno otwarte albo wklej oba teksty do Notatek.

Każde naciśnięcie „Połącz skrót” robi nowy token, a stary przestaje działać.

## 2. Zbuduj skrót w aplikacji Skróty

1. Otwórz **Skróty** → **+** (nowy skrót). Nazwij go **Zapisz przepis**.
2. Naciśnij ⓘ (na dole) i włącz **Pokaż w arkuszu udostępniania**. W „Typy arkusza udostępniania” zostaw tylko **Obrazy**.
3. Na górze pojawi się „Odbierz **Obrazy** z **Arkusz udostępniania**”. Przy „Jeśli brak danych” wybierz **Zatrzymaj i odpowiedz**.
4. Dodaj akcję **Zmień rozmiar obrazu**: obraz = *Dane wejściowe skrótu*, szerokość **1200**, wysokość *automatycznie*.
5. Dodaj akcję **Konwertuj obraz**: na **JPEG**, jakość ok. 80%.
6. Dodaj akcję **Pobierz zawartość adresu URL**:
   - adres: wklej skopiowany **Adres** (kończy się na `/functions/v1/przepis/shortcut`),
   - rozwiń „Pokaż więcej”, **Metoda: POST**,
   - **Nagłówki** → dodaj nowy: klucz `Authorization`, wartość: wklej skopiowany **token** (zaczyna się od `Bearer `),
   - **Treść żądania: Formularz** → dodaj pole **Plik**, klucz `obraz`, wartość: *Przekonwertowany obraz*.
7. Dodaj akcję **Pokaż powiadomienie** z treścią *Zawartość adresu URL*.

Gotowe. Odpowiedź serwera („Zapisano „Sernik”…” albo co poszło nie tak) pokaże się jako powiadomienie.

## 3. Sprawdź

Zrób zrzut ekranu dowolnego przepisu, w Zdjęciach naciśnij **Udostępnij → Zapisz przepis**. Po kilku–kilkunastu sekundach powinno pojawić się powiadomienie, a w aplikacji „📥 1 nowy przepis ze skrótu”.

Gdy mama zaznaczy 2–3 zrzuty naraz, skrót wyśle je wszystkie razem i powstanie jeden przepis.

## Gdy coś nie działa

| Komunikat | Co zrobić |
| --- | --- |
| „Skrót nie jest połączony…” | Token jest zły albo nieaktualny. Zrób nowy w Ustawieniach i wklej go w nagłówek. |
| „Sam link nie wystarczy…” | Udostępniono link do rolki zamiast zrzutów. Facebook nie pozwala odczytać rolki, potrzebne są zrzuty ekranu. |
| „Dzienny darmowy limit…” | Darmowy limit Gemini na dziś się skończył. Jutro zadziała znowu. |
| Brak powiadomienia | Sprawdź internet i czy adres jest wklejony w całości. |

Skopiowany opis z Facebooka wkleja się w aplikacji (Dodaj przepis → pole opisu), skrót służy do zrzutów.

Tego skrótu nie dało się jeszcze sprawdzić na prawdziwym iPhonie. Jeśli przy kilku zrzutach naraz powstanie przepis tylko z pierwszego, daj znać, poprawię instrukcję.
