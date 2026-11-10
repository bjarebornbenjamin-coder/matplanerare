# Matplaneraren

Planera veckans mat utifrån det du har hemma och hur veckan ser ut, håll koll på matlagret och handla smart. Webbapp (PWA) i React, TypeScript och Vite. Data sparas först i webbläsaren (IndexedDB) och kan synkas mellan enheter via Supabase.

Matplaneraren är utbruten ur Studieassistenten (repot `assistent`, grenen `studieassistent-v1`).

## Funktioner

- **Meny (startsidan):** AI:n planerar 3–7 middagar utifrån matlagret (det som går ut först), dina näringsmål, preferenser och allergier. Välj vilka veckodagar du har **kort om tid** (snabba middagar) och vilka som är **träningsdagar** (proteinrikt). För varje dag hämtas ett riktigt recept från nätet, och det som saknas för hela veckan läggs på inköpslistan med ett tryck. Överst visas dagens kost.
- **Recept:** välj "Bara det jag har hemma", "Det jag har hemma, handla lite" eller "Handla det som behövs". AI:n söker upp riktiga recept (ICA, Köket, Arla m.fl.), ingredienserna läses från receptsidan och jämförs med lagret.
- **Lager:** varor med mängd och bäst före-datum. Lägg in för hand eller skanna kvitto eller kylskåp med kameran.
- **Inköp:** inköpslista; köpta varor kan flyttas till lagret.
- **Kost:** logga måltider (AI kan uppskatta näringen) och vatten, se dagen mot målen och utvecklingen över tid.
- **Chatt:** matassistent som läser lager, inköpslista, meny och kost och föreslår ändringar som du bekräftar. Söker recept på samma sätt som Recept-sidan.
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

OpenAI-anropen går via `/api/chat` och `/api/models`. Nyckeln finns bara som miljövariabel på servern.

| Variabel | Syfte |
|---|---|
| `OPENAI_API_KEY` | Din OpenAI-nyckel (obligatorisk) |
| `APP_PASSWORD` | **Valfritt.** Lösenord som appen skickar med (`x-app-password`). Skriv in det i Inställningar. Sätter du inget är åtkomsten **öppen**: alla som har webbadressen kan använda din OpenAI-nyckel (med strängare gräns: 10 anrop/min och 100/dygn per besökare, `OPEN_DAILY_LIMIT`). Sätt en utgiftsgräns hos OpenAI om du kör öppet. |
| `RATE_LIMIT_PER_MIN` | Anrop per minut och användare (standard 20). Gäller per serverinstans, så det är ett skydd mot misstag, inte en exakt kvot. |

Sätt dessutom en utgiftsgräns på nyckeln hos OpenAI. Lokalt: `vercel dev` startar både appen och funktionerna.

## Synk mellan enheter (Supabase)

Lokalt först: allt fungerar offline i IndexedDB. När du loggar in synkas meny, matlager, inköpslista, måltider, vatten och inställningar mot Supabase. Chatthistorik och lösenord synkas inte.

1. Skapa ett projekt på supabase.com.
2. SQL Editor: kör innehållet i `supabase/schema.sql` (tabell + Row Level Security).
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
