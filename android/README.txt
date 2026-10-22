scadshape för Android – omslag (påbörjat 2026-10-22)
====================================================

Webbappen (../dist-bygget) i en WebView, helt offline. Byggs utan Gradle som ~/opt/messenger-web.

  ./build.sh            → dist/scadshape.apk (för test: Taildrop) och dist/scadshape.aab (för Play)
                          (bygger webbappen till build/assets/www, inte ../dist)
  tailscale file cp dist/scadshape.apk <telefon>:

AAB (2026-10-22): samma kompilering som APK:n. aapt2 länkar en gång till i protobuf-format med
samma resurs-id:n (--emit-ids/--stable-ids), basmodulen (manifest/, dex/, res/, assets/,
resources.pb) packas till en AAB med bundletool (~/opt/android-build/bundletool, 1.18.3 från
github.com/google/bundletool, sha256 kontrollerad) och signeras med jarsigner (SHA256withRSA).
build.sh kör bundletool validate. Kontrollerat: en universal-APK som bundletool bygger ur AAB:n har
samma filer, dex och certifikat som APK:n; bara bundletools meta-data i manifestet skiljer.
Nedladdning från Play ≈ 5,4 MB (bundletool get-size).
Play App Signing (väljs när appen skapas i Play Console):
  a) Google skapar appens signeringsnyckel, release.jks blir bara uppladdningsnyckel. Då kan en
     APK härifrån inte installeras över Play-versionen (olika signatur).
  b) release.jks laddas upp som appens signeringsnyckel (Googles PEPK-verktyg) och en separat
     uppladdningsnyckel skapas. Då är APK:er härifrån (GitHub/Obtainium/F-Droid) och Play-versionen
     utbytbara.

Version: VERSION_CODE/VERSION_NAME i build.sh – höj VERSION_CODE för varje utskick.
signing/ = nyckeln. Tappas den går uppdateringar inte att installera över appen (behåll en kopia).
Paketnamn dev.archserver.scadshape är tillfälligt: bestäm det slutliga (följer namnet) innan
appen laddas upp till Play – det går inte att byta efteråt.

Inga behörigheter alls, inte ens INTERNET (0.2.0, fungerar på telefonen 2026-10-22).
Modellerna ligger i IndexedDB (src/kv.ts, sedan 2026-10-22) i WebViews data, som Androids
automatiska säkerhetskopiering tar med (allowBackup="true"). Uppdateras appen över en äldre version
flyttas modellerna från localStorage vid första starten.

Så fungerar det (src/dev/archserver/scadshape/)
  MainActivity  Filerna serveras från https://appassets.androidplatform.net/ ur assets/www
                (säkert ursprung: WASM, workers, IndexedDB som på webben). Alla andra adresser
                får 403 – appen använder aldrig nätet. Länkar ut öppnas i webbläsaren.
                Kant till kant med padding för system-/tangentbordsrader (som messenger-web).
                Bryggan window.ScadshapeAndroid:
                  saveFile  → Hämtade filer (MediaStore, ingen behörighet krävs från Android 10)
                  shareFile → dela-menyn (cache/share/<namn> via Files, bara senaste delningen)
                  setBars   → systemradernas färg/ikoner efter appens tema
                  takeFile  → fil som en annan app öppnade/delade hit (VIEW/SEND)
                Bakåt: sidan stänger översta dialog/panel/skissläge (src/ui/android.ts back());
                inget öppet → appen läggs i bakgrunden.
  Files         ContentProvider för delade filer (inte exporterad, läsrätt per delning).
Sidans del: src/android.ts (bryggan) och src/ui/android.ts. I webbläsaren finns ingen brygga och
allt går som förut. Service workern registreras inte i appen.
Appbygget (SCADSHAPE_VERSION satt) har __DEV_TOOLS__ = false (src/globals.d.ts): mätknappen och all
kod som skickar loggar/mätningar till servern (api/log, api/bench, serverns adress) tas bort vid
minifieringen. Kontroll: grep efter "api/" i build/assets/www/*.js ska ge noll träffar.

Test
  tools/browser/android.mjs – låtsad brygga mot appens egna filer (se filens huvud). Kontrollerar
  fil vid start, spara/dela 3MF, bakåt, skissläge, delad STL, mörkt tema, ingen service worker.
  Riktigt test = på telefonen.

Kvar inför Play
  Välja Play App Signing a/b (se ovan).
  Källkoden publik (GPL-3): ett publikt förråd, sedan SOURCE_URL i src/licenses.ts (då visas
  länken i "Om"). GPL kräver också att källkoden till OpenSCAD-motorn finns att få: "Om" pekar på
  github.com/openscad/openscad + openscad-wasm; spara gärna en egen kopia av källkoden för den
  snapshot som ligger i vendor/openscad (2026.10.15) när appen släpps.
