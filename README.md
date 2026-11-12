# Matplaneraren

Planera veckans mat utifrån det du har hemma och hur veckan ser ut, håll koll på matlagret och handla smart. Webbapp (PWA) i React, TypeScript och Vite. Data sparas först i webbläsaren (IndexedDB) och kan synkas mellan enheter via Supabase.

Matplaneraren är utbruten ur Studieassistenten (repot `assistent`, grenen `studieassistent-v1`).

## Funktioner

- **Meny (startsidan):** AI:n planerar 3–7 dagar: middag varje dag, och frukost och lunch de dagar du valt (alla med riktiga recept från nätet), utifrån matlagret (det som går ut först), dina preferenser och allergier. Skriv önskemål för veckan i fri text (t.ex. "fredag något lyxigt", "onsdag under 30 minuter"). Under Anpassa veckan väljer du vilka dagar du vill ha **frukost** och **lunch**, vilka dagar du **storkokar** (middagen lagas med extra portioner och blir matlådor till luncherna de närmaste fyra dagarna), allergier, portioner och vilka veckodagar du har **kort om tid** (snabba middagar) och vilka som är **träningsdagar** (proteinrikt). En ny meny ersätter hela den kommande menyn (väljer du 3 dagar blir det 3 dagar). Medan menyn görs visas "köket": en animerad helskärmsvy där rätterna dyker upp dag för dag och får en bock när receptet är hämtat (kan döljas; arbetet fortsätter då i bakgrunden). **Jag åt detta** på en rätt visar vad som dras från lagret (mängder som går att räkna minskas, det som tar slut tas bort) och markerar rätten som uppäten. För varje dag hämtas ett riktigt recept från nätet, och det som saknas för hela veckan läggs på inköpslistan med ett tryck. Överst visas kvällens middag, vatten idag, lagret och veckan.
- **Lager:** varor med mängd och bäst före-datum. Lägg in för hand eller skanna kvitto eller kylskåp med kameran.
- **Inköp:** inköpslista; köpta varor kan flyttas till lagret. "Lägg det som saknas på inköpslistan" låter AI:n räkna ihop veckans alla ingredienser mot lagret: samma vara slås ihop, namnen rensas ("Franska örter", inte "frysta franska örter 3 g") och mängderna avrundas uppåt till förpackningar man kan köpa. "Städa listan" gör samma sak med listan som den är. Utan AI läggs det som saknas till med rensade namn.
- **Vatten:** fyll på glas direkt på startsidan; målet ställs in under Inställningar → Vatten. Appen räknar inte kalorier eller makron.
- **Notiser:** mat som snart går ut (med kvällens middag) och inköpslistan en vald veckodag.

## Kommandon

```bash
npm install
npm run dev      # utveckling
npm test         # enhetstester
npm run build    # produktionsbygge i dist/
```

## Publicera

Vercel: Import Project från GitHub-repot. Inga inställningar behövs (Vite detekteras, `vercel.json` hanterar routing).

## Server (Vercel-funktioner i `api/`)

OpenAI-anropen går via `/api/ai` (veckomeny och bildläsning), `/api/recipes` (receptsökning) och `/api/models`. Nyckeln finns bara som miljövariabel på servern.

| Variabel | Syfte |
|---|---|
| `OPENAI_API_KEY` | Din OpenAI-nyckel (obligatorisk) |
| `APP_PASSWORD` | **Valfritt.** Lösenord som appen skickar med (`x-app-password`). Skriv in det i Inställningar. Sätter du inget är åtkomsten **öppen**: alla som har webbadressen kan använda din OpenAI-nyckel (med strängare gräns: 10 anrop/min och 100/dygn per besökare, `OPEN_DAILY_LIMIT`). Sätt en utgiftsgräns hos OpenAI om du kör öppet. |
| `ALLOWED_MODELS` | **Valfritt.** Kommaseparerade modeller som `/api/ai` får använda. Standard: `gpt-4o-mini, gpt-4o, gpt-4.1-nano, gpt-4.1-mini, gpt-4.1, gpt-5-nano, gpt-5-mini, gpt-5`. Andra modeller nekas, och modellistan i appen visar bara dessa. |

**Begränsningar på servern**

- `/api/ai` skickar bara vidare `model`, `messages` (roll och text/bild) och `response_format` (`json_object` eller `text`). Allt annat (t.ex. `tools`, `stream`, `max_tokens`) tas bort, och servern sätter själv taket `max_completion_tokens: 6000`.
- **Hastighetsbegränsning per användare** (429 med `Retry-After` när gränsen nås): AI 10/min och 150/dygn, recept 30/min och 400/dygn, modellistan 10/min och 200/dygn, testnotis 5/min. Räknaren ligger i Supabase och gäller över alla Vercel-instanser; **kör `supabase/rate_limits.sql` en gång** i SQL Editor. Innan den körts gäller bara en gräns per serverinstans (och en varning skrivs i Vercels loggar).
- `/api/recipes` hämtar bara receptsidor över https på port 443. Domännamnet slås upp och alla adresser måste vara publika (inga 127.0.0.1, 10.x, 192.168.x, 169.254.169.254 osv.); anslutningen görs till den kontrollerade adressen, och omdirigeringar följs högst 3 gånger med samma kontroll. Klienten kan inte skicka med egna adresser.
- `GET /api/health` svarar bara `{"ok":true}`. Detaljerna för "Testa anslutningen" (`POST`) kräver inloggning eller lösenord, och kontrollen mot OpenAI sparas i 5 minuter.
- Alla sidor skickas med `Content-Security-Policy` (bara egen kod, Google Fonts och Supabase), `X-Frame-Options: DENY` och `frame-ancestors 'none'` (går inte att lägga i en iframe), `X-Content-Type-Options: nosniff` och `Referrer-Policy: strict-origin-when-cross-origin` (se `vercel.json`).

Sätt dessutom en utgiftsgräns på nyckeln hos OpenAI. Lokalt: `vercel dev` startar både appen och funktionerna.

## Synk mellan enheter (Supabase)

Lokalt först: allt fungerar offline i IndexedDB. När du loggar in synkas meny (middag, frukost och lunch), betyg på rätter, matlager, inköpslista, vatten och inställningar mot Supabase. Lösenordet synkas inte.

1. Skapa ett projekt på supabase.com.
2. SQL Editor: kör innehållet i `supabase/schema.sql` (tabell + Row Level Security) och sedan `supabase/rate_limits.sql` (hastighetsbegränsning för AI-anropen).
3. Authentication → Providers → Email: stäng av "Confirm email" om du vill kunna logga in direkt efter att du skapat kontot.
4. Lägg i Vercel (Environment Variables) och bygg om:
   - `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` (Project Settings → API; anon-nyckeln är publik och skyddas av Row Level Security)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` och `ALLOWED_EMAILS` (din e-postadress) så att servern bara släpper in dig till OpenAI-anropen
5. Öppna appen. När synken är installerad börjar appen med en inloggningssida: skriv e-post (samma som i `ALLOWED_EMAILS`) och ett lösenord och tryck **Skapa konto**. Din befintliga data laddas upp första gången. Inloggningen sparas på enheten.
6. **Stäng sedan av nya registreringar** (Authentication → Sign In / Providers → "Allow new users to sign up" av). Det är en personlig app.

Konflikter: en ändring du gjort lokalt men inte hunnit synka vinner över en inkommande ändring; i övrigt gäller senaste skrivningen på servern. Borttagningar synkas.

## Push-notiser

Kräver att synken (Supabase) är påslagen. Appen räknar ut vilka notiser du ska få 14 dagar framåt (mat som snart går ut, med kvällens middag, och inköpslistan en vald veckodag) och lägger dem i Supabase. En serverfunktion skickar dem när tiden är inne, även när appen är stängd.

1. Generera nycklar: `npx web-push generate-vapid-keys`
2. Kör den andra delen av `supabase/schema.sql` (tabellerna `push_subscriptions` och `notifications`; hela filen går att köra om).
3. Vercel, miljövariabler (bygg om efter att du lagt till dem):
   - `VITE_VAPID_PUBLIC_KEY` och `VAPID_PUBLIC_KEY`: den publika nyckeln
   - `VAPID_PRIVATE_KEY`: den privata nyckeln (hemlig)
   - `VAPID_SUBJECT`: `mailto:din@mejl.se`
   - `SUPABASE_SERVICE_ROLE_KEY`: Project Settings → API → service_role (hemlig, kringgår Row Level Security, används bara av servern)
   - `CRON_SECRET`: ett långt slumpmässigt värde
4. Något måste anropa `/api/push-dispatch` varje minut. Enklast: kör `supabase/cron.sql` (pg_cron + pg_net) efter att du bytt ut adressen och hemligheten. Vercels gratisnivå tillåter bara ett schemalagt jobb per dygn, så det duger inte.
5. Appen → Inställningar → Notiser → **Slå på notiser på den här enheten** → **Skicka testnotis**.

Mat-notiser (Inställningar → Notiser): "Mat som snart går ut" (varor som går ut idag eller imorgon, vid vald tid) och inköpslistan en vald veckodag. Båda planeras av appen utifrån lager och lista som de ser ut när du senast öppnade appen, så ändringar du gör i appen uppdaterar planen.

Fristående påminnelser (Hem → Alla påminnelser) skickas på samma sätt, med valfri tid och upprepning (en gång, varje dag, valda veckodagar). De räknas in i samma 14-dagarsplan.

Begränsningar: iPhone kräver att appen är installerad på hemskärmen (iOS 16.4+). Notiserna planeras 14 dagar framåt, så appen behöver öppnas minst varannan vecka. Ändrar du lagret eller inköpslistan på en enhet uppdateras planen när appen är öppen där.

## Recept från nätet

Servern (`/api/recipes`) låter OpenAI leta upp riktiga receptsidor med webbsökning (Responses API och verktyget `web_search`; modellerna gpt-4.1-mini, gpt-4o-mini, gpt-5-mini och gpt-4.1 provas i tur och ordning, eller först den som står i `RECIPE_SEARCH_MODEL`). Servern hämtar varje sida och läser receptet ur sidans strukturerade data (schema.org/Recipe). Bara sidor som går att läsa som recept visas, så länkarna är aldrig påhittade. Webbsökningen kostar mer per anrop än vanliga AI-svar.

Att läsa av receptsajter är rimligt för personligt bruk. Ska appen säljas eller släppas brett behövs tillstånd från sajterna eller licensierade recept.

## Data och säkerhet

- Allt sparas i IndexedDB och kan exporteras/importeras som JSON (Inställningar → Säkerhetskopia, format `matplanerare` version 1).
- OpenAI-nyckeln finns bara på servern. Lösenordet till servern sparas lokalt och ingår aldrig i exporten. Lägg aldrig nycklar i koden eller i repot.

## Typsnitt, ikoner och design

- Typsnittet är [Inter](https://rsms.me/inter/) (SIL Open Font License), som laddas från Google Fonts.
- Ikonerna för kugghjul och öga bygger på [Feather Icons](https://feathericons.com) (MIT-licens, © Cole Bemis).
- Färger och layout är inspirerade av Material Design. Appen använder inte Googles logotyper, namn eller typsnittet Google Sans.
