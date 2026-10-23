scadshape – parametriskt CAD-program för Android, byggt på OpenSCAD
=====================================================================

Mål: rita skisser (linje, rektangel, cirkel, 3-punktsbåge …) med fingret,
extrudera/revolve i ett feature-träd, allt offline i telefonen. Modellen är
feature-trädet (JSON); OpenSCAD-kod genereras ur det och renderas av
OpenSCAD-WASM med Manifold-backend. Webbsida först, APK-omslag senare
(som ~/opt/messenger-web).

Status: fas 0–3 klara 2026-10-16 (spike, skissverktyg, villkor/mått, features).
2026-10-17: omstrukturering (moduler, feature-register), svenska/engelska, gängor,
förskjutna skissplan; sedan behållare (fack, insticks-/skruvlock), export 3MF/STL/.scad
(fas 4), upprepa (linjärt/rutnät/runt axel/spegla) och kanter (hörnradie, avrunda/fasa)
(fas 5), PWA (offline, installerbar) + publik server klar för Cloudflare-tunneln,
modeller (flera projekt, fil in/ut), text (8 typsnitt), ångra i delläget, skissverktygen
polygon och avlångt hål, avrunda/fasa skisshörn (sketch/fillet.ts), mätverktyg i 3D (measure.ts), import av STL/SVG (Importera), mörkt tema (☰ → Tema), snäpplås (snäpphake/urtag, snäpplock). Kvar: publik adress,
Android-appen inför Play (android/README.txt), fler features (se Idéer).

Arkitektur (2026-10-17)
  src/features/        en fil per feature-typ: data, standardvärden, panelens fält,
                       beskrivning i trädet och OpenSCAD-kod (build). index.ts = register.
                       Ny typ: skriv features/<typ>.ts, lägg in i KINDS och SolidFeature,
                       lägg till en knapp i verktygsfältet (startFeature) och texter i i18n.
  src/model3d.ts       sätter ihop modellen ur features (union/difference/intersection).
  src/ui/              render, tree, panel (fält byggs från features/*.fields), pickers
                       (val i 3D: regioner, axel, punkter, cirklar), params, sketchmode,
                       bench, dom, state (delat tillstånd + händelser), toast.
  src/i18n.ts + i18n-sv.ts/i18n-en.ts  t('nyckel'), data-i18n i HTML; engelska typkontrolleras
                       mot svenska (saknad översättning = kompileringsfel). Språkval i ☰.
                       Standardnamn ("Skiss 1"/"Sketch 1") följer språket.

Behållare (features/container.ts)
  Sluten profil → låda: höjd, vägg, botten, hörnradie, fack i X/Y (avdelare, lägre än
  lockkanten). Lock bredvid (för utskrift): insticks (platta + kant innanför väggen, spel per
  sida) eller skruv (bara cirkel: utvändig gänga i halsen med 45° övergång inuti, lock med
  invändig gänga och grepp). Utan skiss skapar knappen en mallskiss 80 × 60 med mått.
  Testat: locket går att skruva på (överlapp 0 i rätt vinkel, > 50 mm³ i fel).

Upprepa och kanter (features/pattern.ts, extrude.ts)
  Varje feature har "Upprepa": linjärt (axel, antal, avstånd), rutnät, runt axel (antal,
  vinkel; 360 = jämnt), spegla (plan genom origo). Läggs runt featurens verktyg i model3d.
  Gängor speglas inte (blir vänstergänga) – fel med förklaring.
  Extrudera: hörnradie (rundar in- och utåtgående hörn med offset), kant avrunda/fasa vid
  ytteränden/skissen/båda (lager av offset-profiler).

Modeller (projects.ts, ui/projects.ts, kv.ts)
  Flera modeller i IndexedDB (databasen "scadshape", tabellen "kv", sedan 2026-10-22; tidigare
  localStorage): scadshape.projects (index), scadshape.doc.<id>, scadshape.current. kv.ts läser allt
  till minnet när modulen laddas (top-level await) och skriver varje ändring vidare, så projects.ts är
  synkron som förut. Finns modellnycklar i localStorage flyttas de (ersätter IndexedDB, läses tillbaka
  och jämförs, tas sedan bort ur localStorage). Utan IndexedDB: localStorage, annars minnet. Misslyckad
  skrivning → röd notis (storageHooks). UI-inställningar, språk, tema och Egen kod ligger kvar i
  localStorage. Test: tools/browser/storage.mjs.
  Starten: main.ts sätter temat, väntar på openStorage(), sedan initState() och resten. <body> har
  klassen loading (dold) tills allt är kopplat; tester väntar på body:not(.loading) innan de läser
  window.__scadshape (där storage är en testkrok för att läsa/skriva/tömma lagringen). Det gamla enda dokumentet (scadshape.doc) blir "Min modell" vid första
  starten. ☰ → namnet → lista: öppna, byt namn, duplicera, ta bort, ny, öppna fil, spara som
  fil (.scadshape.json). Öppna fil tar också .scad: öppnas som Egen kod och renderas (filväljaren
  har inget accept-filter – Android gråar annars ut .scad). Ångra/gör om i delläget (ui/history.ts): ögonblicksbild per ändring,
  nollställs vid byte av modell.

Text (features/text.ts, fonts.ts)
  Upphöjd/ingraverad text vid valda punkter (annars skissens origo), start (mm från planet).
  Typsnitt i public/fonts/ (OFL, LICENSE.txt): Liberation Sans (+ fet), Allerta Stencil, Bebas
  Neue, Pacifico, Orbitron (Medium = "Orbitron", Bold, Black; 2026-10-23). Motorn får hela familjen
  när koden nämner den (fontsFor: "Orbitron:style=Medium" eller bara "Orbitron" räcker); workern
  hämtar och cachar dem och sätter FONTCONFIG_FILE i preRun. Variabla typsnitt (t.ex. Googles
  Orbitron[wght]) kraschar WASM-bygget – använd statiska .ttf. Orbitron har reserverat namn (OFL
  RFN): egna instanser ur den variabla filen (fontTools) får inte heta Orbitron, därför projektets
  egna omodifierade statiska filer (v1.000, github.com/theleagueof/orbitron) – originalritningen,
  något annorlunda än Googles 2.001 på servern. Test: model.test "Orbitron, Bold och Black väljs".

Bibliotek (libs.ts, vendor/libraries/)
  Samma bibliotek som på servern, kopierade 2026-10-17 (bara *.scad + LICENSE, se VERSION):
    BOSL2 2.0.766 (BSD-2)              include <BOSL2/std.scad>              1,06 MB gz
    Round-Anything (MIT)               use <Round-Anything/polyround.scad>   12 kB gz
    dotSCAD 3.3 (LGPL-3)               use <dotSCAD/src/line2d.scad>         94 kB gz
    gridfinity-rebuilt-openscad (MIT)  use <gridfinity-rebuilt-openscad/…>, eller hela
                                       gridfinity-rebuilt-bins.scad inklistrad      47 kB gz
  build.mjs paketerar varje bibliotek till dist/libs/<namn>.json. Motorn skickar bara med de
  bibliotek koden använder (include/use <namn/…>, eller detect i libs.ts); workern hämtar JSON:en
  en gång, skriver filerna till /libraries och sätter OPENSCADPATH (plus paths per bibliotek:
  dotSCAD/src och gridfinitys rotkatalog, för deras relativa includes). Ingår i offline-cachen.
  Tider (WASM): BOSL2 cuboid ~0,5 s, screw("M6") ~0,8 s, gridfinity-bin ~0,65 s.
  Fler bibliotek: kopiera till vendor/libraries/<namn> och lägg till i LIBRARIES. Test: libs.mjs.
  Vyn anpassas i Egen kod/exempel när modellen byter storlek/läge kraftigt (inte i egna modeller).

Gör om till skisser (convert/csg.ts, convert/scad2doc.ts, ui/convert.ts, features/code.ts)
  Knappen i kodpanelen (Egen kod/exempel): OpenSCAD kör koden och exporterar CSG-trädet (.csg:
  moduler, loopar, variabler redan utförda). Kroppar som är prismor längs en världsaxel (cube,
  cylinder, linear_extrude, hull av sådana) → skiss på XY/XZ/YZ (+ förskjutning) + Extrudera;
  koner och klot → profil + Revolve; resten (BOSL2-polyedrar, minkowski, hull i 3D, vridna kroppar,
  text med saknat typsnitt) → kodblock (feature "OpenSCAD-kod", ingen skiss, include/use lyfts ut).
  2D: square/circle/polygon direkt (rektanglar och cirklar med mått); offset/text/överlapp ritas
  av OpenSCAD (SVG, fin upplösning) och bågar hittas i punkterna (centrum justerat så att
  ändpunkterna ligger exakt på radien). hull av lika cirklar → rundad form med tangens, lika radier,
  radiemått och (rektangel) ytterbredd/-höjd – bara läget fritt. $fn < 16 behålls som polygon
  (avsiktlig sexkant), cirklar utan $fn blir riktiga cirklar.
  Booleska trädet plattas ut i trädets ordning; en bortdragning som når en tidigare tillagd kropp
  (lådor) gör hela den skillnaden till kod. I en union tas difference/intersection först.
  Prismor i följd med samma plan/höjd/operation slås ihop till en skiss. Efteråt jämförs volymen
  med originalet (renderat med $fa=1, $fs=0,2) och resultatet visas.
  Tester (tests/convert.test.ts): testmodellerna i tests/fixtures/ (snap_box 8 skisser/1 kod,
  bracket 8 skisser/0 kod, bosl2_knob delvis kod, cable_clip, wall_hook; alla ≤ 0,04 % volym) och, om
  den finns, tests/private/ (egna filer som inte publiceras).
  Begränsning: skisserna är fristående – ändras lådans bredd följer inte hålen med (ingen
  koppling som i originalkodens variabler).

Export (ui/export.ts)
  3MF (zip, enhet mm), STL (binär), OpenSCAD-kod. Filen tas fram när dialogen öppnas så att
  knapptrycket kan ladda ner/dela direkt. Chrome på Android delar inte .3mf/.stl via Web Share
  – därför nedladdning (i appen: Hämtade filer och dela-menyn). Filnamn = modellens namn.
  Filerna behöver en slicer (Bambu Studio, OrcaSlicer, PrusaSlicer …). Bambu Handy slicar inte:
  den startar bara färdiga utskriftsfiler (MakerWorld/Bambu Studio) – testat 2026-10-23 på en
  Xiaomi 11T Pro, 3MF gick inte att öppna. Att slica i telefonen (t.ex. Kiri:Moto) och skicka till
  en Bambu-skrivare skulle kräva nät och Bambus .gcode.3mf-format – inte gjort.

Gängor (features/threads.ts, thread.ts, hole.ts)
  ISO-metrisk profil (60°, topp P/8, botten P/4), tvärsnitt r(θ) extruderat med −360°/
  stigning (högergänga). M2–M30 med standardstigning, spel för 3D-utskrift (0,2 mm).
  Hål → Gängat: invändig gänga + kärnhål. Gänga-feature: välj cirklar i 3D; Utvändig skär
  bort cylindern och ersätter med gängad stav (avfasad), Invändig drar bort en gängtapp.
  Storlek föreslås från cirkeln (ytter- resp. innerdiameter). M8×15 mm ≈ 0,05 s, 85k tri.
  Förskjutna skissplan: "Förskjutning" i planvalet (t.ex. plattans höjd/variabel).
  Riktning nedåt vänds med rotate([180,0,0]), inte mirror – en spegling ger vänstergänga
  (tests: "gängor är högergängade i alla riktningar" mäter helixen i meshen).

Skissverktyg (sketch/editor.ts)
  Polygon (G): centrum + hörn, 3/4/5/6/8 sidor; hörn på en konstruktionscirkel + lika sidor
  → mått på cirkeln (t.ex. nyckelvidd) och vridning. Avlångt hål (O): två ändar + bredd;
  bågar och linjer tangenta. Verktygens villkor är "quiet" (symbolerna syns när formen är
  markerad). Tangens i gemensam ändpunkt löses som i FreeCAD (radien ⟂ linjen,
  perpendicular_pppp) – avståndsformen gav fel antal frihetsgrader (slits 9 i stället för 5).

Skissa på en yta (faceref.ts, 2026-10-17)
  Skiss → "Välj yta på modellen" → tryck på en plan yta i 3D. Ytor parallella med
  Topp/Fram/Höger: planet och förskjutningen räknas ut (XZ: förskjutning = −y).
  Sneda ytor: skissen får face = { o, u, v } (frame.ts; normalen u × v ut ur kroppen), placeras
  med multmatrix. Kommer ytan från en extrudering (findFaceRef: sidan som en linje i profilen
  sveper upp, eller en ändyta lo/hi) sparas faceRef { feature, entity | cap, sign } och planet
  räknas om ur den vid varje bygge (linjens lösta punkter, djup, riktning, föräldraskissens
  frame – rekursivt), så skissen följer måtten. Annars (eller om källan tas bort/undertrycks)
  gäller face = senast kända läge. Normal och läge ur alla trianglar
  i planet (areaviktat); u vågrätt längs ytan, v uppför, origo i nedre vänstra hörnet sett utifrån.
  Allt som placerar en skiss (OpenSCAD, 3D-vy, val i 3D, kontur) går via sketchFrame(). Förskjutningen
  blir helst ett uttryck från extruderingen som skapade ytan (t.ex. "t", "2 + t", "-(t / 2)"),
  så skissen följer med när måttet ändras; annars talet. Skissen får outward ('normal'/'reverse')
  = åt vilket håll ytan pekar ut: nya extruderingar/text bygger utåt, "ta bort" vänder inåt,
  hål borrar inåt. I skissläget visas modellens kanter i planet (grått, ur den senaste meshen;
  gäller alla skisser vars plan sammanfaller med en yta) och man snäpper till hörn, cirkelmitt
  och kanter (ny punkt, inget villkor). Vyn anpassas efter ytan bara för skisser från en yta.
  Tester: model.test "skissa på en yta …", tools/browser/faces.mjs.

Licens och "Om scadshape" (2026-10-22)
  scadshape: GPL-3.0 eller senare (LICENSE). Krävs i praktiken: OpenSCAD-WASM:en innehåller CGAL
  (GPL-3); OpenSCAD själv är GPL-2 med undantag för CGAL. ☰ → Om scadshape (src/ui/about.ts) visar
  version (android/build.sh sätter SCADSHAPE_VERSION), licensen och allt som följer med, grupperat
  (src/licenses.ts). Licenstexterna: vendor/licenses/ (tools/licenses.sh hämtar dem från de versioner
  som openscad-wasm-bygget låser + SPDX-texter; SOURCES.txt) och beroendenas LICENSE, kopierade av
  build.mjs till dist/licenses/. Byts OpenSCAD-WASM:en eller ett bibliotek: kör tools/licenses.sh
  och uppdatera src/licenses.ts. Test: tools/browser/about.mjs (alla texter öppnas).
  Bakåt/Esc i en licenstext går tillbaka till listan (Androids bakåt: knappar med data-back).

Bilder i README.md (2026-10-23, docs/media/)
  tools/browser/readme-media.mjs gör om dem mot staging (se skriptets huvud): två GIF:ar
  (sketch-to-part, variables) och fem skärmbilder, engelska, 390 × 844. GIF:arna är bildserier med
  bestämd visningstid per bild (gifenc + pngjs, utvecklingsberoenden i tools/browser); DUMP=<katalog>
  sparar också bilderna som PNG för granskning. Kör om när gränssnittet ändras märkbart.
  Två följdändringar i appen: featurepanelen i stående läge (nertill) flyttar upp modellen ovanför sig
  (viewer.setBottomInset, som setRightInset i liggande) – förut låg modellen dold under panelen; och
  skissvyn ger minst 90 px marginal i sidled (editor.fit), så att måttetiketter med variabelnamn inte
  klipps på smala telefoner.

Startkort och exempel (2026-10-22, ui/welcome.ts, examples/models.ts)
  När modellen är tom visas ett kort i 3D-ytan: fyra steg (Skiss → rita/Mått → Klar + Extrudera …
  → Exportera) och fyra exempel. Det blockerar inte verktygen och döljs när modellen får innehåll,
  en featurepanel öppnas eller man går in i en skiss; × döljer det för sessionen, ☰ → Kom igång
  visar det igen. Exemplen byggs när de öppnas (nya modeller i nuvarande format) med mått som hänger
  på variabler (namnen följer språket): Låda med lock (behållare), Monteringsplatta (extrudering +
  försänkta M4-hål på ovansidan, outward 'normal' så att de borrar nedåt), Skylt (text), Kopp
  (revolve). En burk med skruvlock var med först men tog ~3 s och 357k trianglar (gängorna) – för
  tungt som första intryck. Tester: tests/examples.test.ts (fullt bestämda skisser, renderar,
  variabel ×1,5 → större modell, hålen går igenom), tools/browser/welcome.mjs.
  Verktygsraden tonas i kanten där den fortsätter (ui/scrollhint.ts). Mät prestanda finns bara på
  utvecklingsservern (isDevHost).
  Svag telefon: tools/browser/lowend.mjs (360 × 640, CPU strypt 1/4/6×): start 0,18/0,46/0,69 s,
  exemplen 0,1–0,4 s. Obs: CDP-strypningen gäller inte workern, så motortiderna är serverns.

Android-app (android/, påbörjad 2026-10-22)
  WebView-omslag, helt offline: android/build.sh → android/dist/scadshape.apk. Spara/dela filer,
  öppna filer från andra appar och bakåtknappen går via bryggan i src/android.ts + src/ui/android.ts
  (finns bara i appen). Detaljer och vad som är kvar inför Play: android/README.txt.

Idéer (ej gjort)
  Gridfinity-lådor, gångjärn, ytskiss på revolve/kodblock som följer måtten.

Faser
  0 spike         WASM-motor i Web Worker, 3D-vy med pekgester, mätknapp   ✔
  1 skissverktyg  linje, rektangel, cirkel, polygon, slits, bågar, snäpp       ✔
  2 constraints   planegcs (FreeCADs lösare, WASM), mått med sifferinmatning   ✔
  3 features      extrudera (+/−), revolve, hål, gänga, behållare, text, träd   ✔
  4 utskrift      export 3MF/STL/.scad (nedladdning/dela; vidare till en slicer)  ✔
  5 extra         förskjutna plan, upprepa/spegla, hörnradie, avrunda/fasa kant  ✔
Begränsning: OpenSCAD är CSG/mesh utan B-rep – ingen "klicka på 3D-kant och runda";
kanterna rundas/fasas därför per extrudering (lager om ~0,2 mm, ett per utskriftslager).

Adresser
  Utveckling: http://<SCADSHAPE_HOST>:8790/ (scadshape-web, tar emot loggar). serve.py lyssnar på
    127.0.0.1 om inget annat sägs; för att nå den från telefonen sätts SCADSHAPE_HOST till t.ex.
    Tailscale-IP:n i en systemd-drop-in (~/.config/systemd/user/scadshape-web.service.d/host.conf:
    [Service] + Environment=SCADSHAPE_HOST=<ip>), som inte ligger i förrådet.
  Publik (för Cloudflare-tunneln): 127.0.0.1:8791 (scadshape-public, SCADSHAPE_PUBLIC=1:
    strikt CSP, inga POST, ingen åtkomstlogg). Samma dist/ – ombyggnad når båda direkt.
    Appen skickar loggar/mätningar bara från utvecklingsadressen (remote.ts isDevHost: localhost
    eller en Tailscale-adress 100.64.0.0/10).

Publik adress
  scadshape.com (domänen beställd 2026-10-23): tänkt på Cloudflare Pages – webbappen är statisk,
  publiceras vid varje push till main och är oberoende av hemservern. Inställningar i Cloudflare
  (Workers & Pages → Create → Pages → Connect to Git → aimfoot/scadshape): produktionsgren main,
  byggkommando "npm ci && node build.mjs", utdatakatalog "dist", Node enligt .node-version (22);
  sedan Custom domains → scadshape.com (domänen i samma Cloudflare-konto). Rubrikerna (CSP m.m.)
  kommer från public/_headers – samma som serve.py i publikt läge, håll dem lika. _headers serveras
  inte av Pages och är därför undantagen ur service workerns lista (build.mjs) och ur appen.
  public/privacy.html = integritetspolicyn (engelska + svenska), länkad från Om (licenses.ts:
  WEBSITE_URL, PRIVACY_URL) och README.md.
  Alternativ: en omvänd proxy eller tunnel (t.ex. Cloudflare Tunnel) till 127.0.0.1:8791
  (scadshape-public, steg i HOSTING.local.txt).
  Över https registreras sw.js: appen sparas för offline (cache per innehållshash, ny version
  hämtas i bakgrunden och används vid nästa start) och kan installeras ("Lägg till på
  startskärmen"). manifest.webmanifest + icons/ (ritas av tools/browser/make-icons.mjs).
  CSP kräver 'unsafe-eval': planegcs (embind) skapar funktioner med new Function – utan den
  misslyckades kontrollen av överflödiga mått tyst.

Skissverktyget (fas 1)
  "+ Skiss" → välj plan (Topp XY, Fram XZ, Höger YZ) → rita → "Klar".
  Punkten hamnar där fingret är; förstoringsglas medan fingret är nere; dra
  från första till andra punkten i ett svep, eller tryck punkt för punkt.
  Två fingrar panorerar/zoomar. Snäpp: befintliga punkter/origo (blir delade
  punkter = sammanfallande), rutnät (steg efter zoom), vågrätt/lodrätt (linje).
  Linjekedja avslutas på befintlig punkt, med "Avsluta" eller tryck på sista
  punkten igen. Markera: tryck, dra punkter/linjer/cirkelkant, släpp en punkt på
  en annan för att slå ihop. Konstruktion = streckad, räknas inte som profil.
  Regioner som i ett CAD-program (regions.ts): kurvorna delas där de korsar
  varandra, lösa ändar rensas, varje begränsad yta i den plana grafen blir en
  region (fylls blått). Fristående komponenter inuti en yta blir hål, öar i hål
  material igen. Öppna ändar visas med röd ring. Dokumentet sparas i localStorage.
  tests/phone-sketches.json: handritade skisser med ojämna koordinater (testfall).

Villkor och mått (fas 2)
  Lösare: planegcs (@salusoft89/planegcs, FreeCADs lösare som WASM, dist/planegcs.wasm).
  Varje ändring löses; krockar den (eller är den överflödig, för nya villkor/mått)
  rullas den tillbaka med en röd notis och de inblandade villkoren blinkar rött.
  Dra geometri: temporära villkor drar mot fingret så långt villkoren tillåter.
  Markera → sammanhangsraden visar passande villkor: Vågrät/Lodrät (linjer eller
  två punkter), Parallell, Vinkelrät, Lika, Tangent, Koncentrisk, På linjen/kurvan,
  Mittpunkt, Sammanfoga, Fixera/Lossa, Mått. Mått: linje → längd (längs/vågrätt/
  lodrätt), cirkel → diameter, båge → radie (växla), två linjer → vinkel (parallella
  → avstånd), punkt+linje, två punkter. Måttfältet tar uttryck (40/2+5).
  Tryck på ett mått för att ändra/ta bort. Automatiska villkor vid ritning:
  vågrätt/lodrätt, sammanfallande (delad punkt), på kurva (snäpp mot kurva ▢),
  mittpunkt (snäpp ▲). Blått = kan röra sig, svart = fullt bestämt (frihetsanalys:
  alla punkter dras slumpvis med temporära villkor – det som rör sig är fritt).
  Statusraden visar frihetsgrader eller "Fullt definierad".
  planegcs diagnostiserar i startläget, därför löses varje gång två gånger
  (andra gången från den lösta geometrin) – annars missas överflödiga villkor.

Features (fas 3)
  Dokument v2 (doc.ts): features i ordning (skiss, extrudera, revolve), variabler,
  rollback-markör. v1 (fas 1–2) migreras: varje skiss med regioner får en extrudering
  med den gamla förhandsvisningshöjden. model3d.ts bygger OpenSCAD: en modul per
  feature; lägg till = union, ta bort = difference, snitt = intersection, i trädets
  ordning. Fel per feature (t.ex. "Profilen korsar axeln", "Okänd variabel") visas med
  ⚠ i trädet och featuren hoppas över.
  Extrudera: skiss, regioner, höjd (uttryck), uppåt/nedåt/symmetrisk, operation.
  Revolve: axel = skissens X/Y-axel eller en linje i skissen (ofta konstruktionslinje),
  vinkel, symmetriskt, operation. Profilen måste ligga på ena sidan om axeln.
  Regionval: panelen visar skissens regioner som ytor i 3D; tryck för att välja/avvälja.
  Valet sparas som en punkt inuti varje region ("frö"), så det överlever skissändringar.
  Standard (inget valt) = det som är material med jämnt djup (ring runt hål osv.).
  Axelval: "Välj axel"/"Linje" visar kandidater streckade; tryck på en.
  Trädet (☰): tryck = redigera; ⋯ = redigera, undertryck, rulla tillbaka hit, ta bort
  (en skiss tar med sig features som bygger på den). Nya features läggs vid markören.
  Variabler (fx): namn = uttryck, får använda variabler ovanför. Används i höjd/vinkel
  och i skissmått (måttet sparar uttrycket; ändras variabeln räknas skissen om och
  löses). Svenska namn översätts i koden (höjd → hojd) eftersom OpenSCAD bara tål a–z.
  Förhandsvisning medan panelen är öppen (senaste begäran vinner, 350 ms efter tangent).
  Liggande: 3D-vyn förskjuts så att modellen hamnar bredvid panelen.

Avrunda/fasa skisshörn (src/sketch/fillet.ts)
  Markera hörnpunkter (två linjer möts, inte parallella) eller linjer → Avrunda / Fasa i
  sammanhangsraden; måttdialogen öppnas (radie resp. ben). Flera hörn: ett mått, resten Lika.
  Avrunda: linjerna trimmas till tangentpunkterna, båge + tangentvillkor + radiemått.
  Fasa: rak linje, konstruktionsben från hörnet (Lika) + mått på det första benet.
  Virtuellt hörn: har hörnpunkten mått/villkor (eller är origo) – och alltid vid fasning –
  behålls den på linjernas förlängning (punkt på linje + streckade ben), så måtten gäller.
  Linje med Lika/Mittpunkt blir konstruktion i full längd + trimmad kopia (polygonens sidor).
  Frihetsgraderna ändras inte. Tester: solver.test "avrunda/fasa …", tools/browser/fillet.mjs.
  Bara linje–linje-hörn (inte linje–båge).

Mätverktyget (src/measure.ts, src/ui/measure.ts)
  "Mät" i delens verktygsrad. Tryck fäster mot synligt hörn (18 px; inte punkterna längs en
  tessellerad cirkel), annars synlig kant (14 px), annars ytan. Kant → hela den raka kanten
  (längd) eller cirkel/båge (Ø/R, centrum; kedjan av nätets kanter följs så länge punkterna
  ligger på samma cirkel med jämna segment). Ett val: mått/koordinater. Två val: avstånd +
  ΔX/ΔY/ΔZ (cirkel räknas från centrum); parallella ytor/kanter → vinkelrätt avstånd, annars
  vinkel; punkt → yta/kant vinkelrätt. Tredje trycket börjar om; ny rendering rensar valen.
  Tester: tests/measure.test.ts, tools/browser/measure.mjs.

Import (src/ui/importer.ts, Importera i delens verktygsrad)
  STL (binär/ASCII, högst 64 MB) → feature "Importerad kropp" (features/mesh.ts): mitt på plattan
  (botten på Z = 0), skala %, rotera, flytta, lägg till/ta bort/snitt. Filen ligger i IndexedDB
  efter innehållshash (src/blobs.ts; dokumentet sparar bara hashen). Motorn (scad.ts) ser
  import("/imports/<hash>.stl") i koden och skriver filen till workerns filsystem. "Spara som fil"
  bäddar in filerna (base64, "files") och "Öppna fil" sparar dem; .scad-exporten pekar på
  originalfilens namn. Saknas filen i webbläsaren blir det ett fel i trädet. Filer tas inte bort
  när modellen raderas (IndexedDB "scadshape-files").
  SVG (src/svg.ts, egen XML-läsare): path (alla kommandon), rect (rx/ry), circle, ellipse, line,
  polyline, polygon, g/transform, viewBox/enheter → mm, y uppåt. Text, bilder och use hoppas över
  (räknas upp i dialogen). Cirkelbågar blir skissbågar om transformen är likformig, Bézier plattas
  ut (0,02 mm). Dialog: bredd (skalar likformigt), hörnet/mitten i origo, lås → sedan planvalet
  (även yta på modellen); geometrin hamnar i en ny skiss med filens namn. Lösaren klarar inte
  många fria punkter (1000 fria = minnet tar slut i planegcs; fixerade är billiga): över 150
  punkter låses som standard, över 600 alltid, över 6000 vägras.
  Tester: tests/svg.test.ts, tools/browser/import.mjs (pwa.mjs körs med ?sw i adressen).

Tema (src/theme.ts, ☰ → Tema: Som telefonen / Ljust / Mörkt)
  Valet sparas (scadshape.theme); det lösta temat blir data-theme på <html>. Alla färger i
  style.css är variabler med mörka värden (+ media-fråga innan skriptet körts, color-scheme för
  formulär). Skissens canvas har två paletter (editor.ts LIGHT/DARK; fullt bestämt = ljust i
  mörkt), 3D-vyn byter rutnät och skisslinjer (viewer.setTheme). Test: tools/browser/theme.mjs.

Snäpplås
  Snäpphake (features/snap.ts) vid punkter i en skiss (inga valda = fristående punkter, annars
  origo; utan skiss en mallskiss i XY): Hake = böjbalk längs planets normal, centrerad på punkten,
  hulling åt Riktning (grader i planet), 30° infasning, baksida låsande 90° eller lösbar 45°,
  45°-fas i roten. Panelen visar töjningen i roten ε = 1,5·t·y/L² och varnar över 2,5 % (PLA),
  plus tips om utskriftsriktning (stående hake böjs tvärs lagren). Urtag = fack (t + y + 2·spel)
  × (b + 2·spel) × djup som skärs in i kroppen. Fälttypen 'note' (common.ts) visar uträknad text.
  Snäpplock (behållare, lock "Snäpp"): insticks­lock vars kant buktar ut snapDepth (0,6) med
  45°-flanker nära spetsen, och ett spår på samma höjd i väggen (+0,15 mm). Ingrepp = utstick −
  spel. Vulst och spår byggs som skikt på 0,2 mm-lagren (skikt som delar ett lager ger trappsteg
  som slicern inte kan skriva ut); kantväggen behåller sin tjocklek. scadcheck: inga anmärkningar.
  Tester: model.test "snäpplock …", "snäpphake …" (monterat lock: 0 mm³ överlapp med spår,
  ~84 mm³ ingrepp utan), tools/browser/snap.mjs.

Punkter och hål
  Punkt-verktyget (P) i skissen ritar fristående punkter (SPoint.standalone) – de fäster
  mot mittpunkter/kurvor, kan måttsättas och få villkor som andra punkter.
  Hål-featuren borrar i valda punkter (standard: alla fristående punkter; utan sådana
  cirkel-/bågcentrum). Välj/avvälj genom att trycka på punkterna i 3D-vyn. Typ: enkelt,
  cylindrisk försänkning, konisk försänkning. Storlek M2–M8 fyller i frigångshål (ISO 273
  medel), försänkning för insexskruv och 90° för försänkt skruv; ändrade mått → "Eget".
  Djup eller genom allt. Borra uppåt/nedåt längs planets normal, med start (mm från
  skissplanet) – t.ex. start = plattans tjocklek och nedåt för försänkning på ovansidan.
  Hålen dras alltid bort och kräver en kropp före sig i trädet.

Filer
  src/main.ts          UI: delläge (3D, källa, kod, features) och skissläge
  src/doc.ts           dokument v2 (features, variabler, rollback), migrering, localStorage
  src/model3d.ts       features → OpenSCAD (extrudera, revolve, operationer, fel per feature)
  src/params.ts, src/paramsync.ts  variabler; räkna om skissmått när de ändras
  src/sketch/model.ts  skissdata: punkter + entiteter (linje/cirkel/båge) + constraints
  src/sketch/geom.ts   2D-geometri, tessellering (kordafel ≤ 0,01 mm)
  src/sketch/regions.ts  slutna profiler och nästling
  src/sketch/codegen.ts  profiler → OpenSCAD 2D (polygon/circle, difference för hål)
  src/sketch/editor.ts   canvas-editorn (verktyg, snäpp, förstoringsglas, villkor, ångra)
  src/sketch/solver.ts   skiss ↔ planegcs: lösning, dragning, frihetsanalys
  src/sketch/annotate.ts mått och villkorssymboler (mätning, ritning, träffytor)
  src/expr.ts          uttryck i måttfält
  src/sketch3d.ts      skisskurvor som linjer i 3D-vyn
  tests/               enhetstester: node tests/run.mjs (skiss, lösare, projekt, modeller med riktig
                       OpenSCAD-rendering – volymer, mått, gängriktning, lockpassning)
  tools/browser/{container,export,pattern,projects,text,history,sketchtools,pwa}.mjs
                       webbläsartester för dagens features (pwa.mjs mot http://127.0.0.1:8791/?sw)
  tools/browser/sketch.mjs  ritar en skiss med riktiga pekhändelser (CDP) och kontrollerar allt
  tools/browser/constraints.mjs  villkor/mått: rektangel → fullt definierad, krock, tangent, drag, ta bort/ångra
  tools/browser/threads.mjs  gängor (utvändig/invändig, cirkelval i 3D) och språkbyte sv↔en
  tools/browser/holes.mjs  punktverktyget, hål: punktval i 3D, försänkning, M-storlekar, redigering
  tools/browser/features.mjs  migrering, variabler, extrudera/ta bort, regionval och axelval i 3D, revolve,
                       rollback/undertryck, variabeländring, omladdning, stående läge
  node build.mjs --out dist-next  bygg utan att publicera (testa med python3 -m http.server)
  src/scad.ts          klient mot workern: render(src) → STL + logg, cancel()
  src/scad.worker.ts   kör OpenSCAD; wasm kompileras en gång, ny instans per rendering
  src/viewer.ts        three.js, Z upp, OrbitControls (1 finger rotera, 2 zooma/panorera)
  src/stl.ts           binär STL → positioner/normaler
  src/examples/*.scad  exempel (paketeras som text)
  public/              index.html, style.css (kopieras till dist/)
  vendor/openscad/     OpenSCAD-WASM (web-build), se VERSION
  build.mjs            esbuild → dist/ (+ .gz). `node build.mjs --watch` under utveckling
  serve.py             server för dist/ + POST /api/bench → data/bench.jsonl
  scadshape-web.service  user-tjänst (systemctl --user restart scadshape-web)
  tools/bench-node.mjs   mät en .scad i Node: node tools/bench-node.mjs fil.scad [manifold|cgal]
  tools/browser/smoke.mjs  röktest i headless Chromium (Playwright):
                           cd tools/browser && node smoke.mjs [url] [utkatalog] [--bench]

Bygga
  cd ~/opt/scadshape && npx tsc --noEmit -p . && node build.mjs
  Ombyggnad publiceras direkt (dist/ töms men tas inte bort – tjänsten bind-monterar den).

Uppdatera OpenSCAD-WASM
  Hämta OpenSCAD-<datum>-WebAssembly-web.zip + .sha256 från
  https://files.openscad.org/snapshots/ i en tom katalog, `sha256sum -c`,
  packa upp (python3 -I -m zipfile -e zip ut/), ersätt vendor/openscad/openscad.{js,wasm},
  uppdatera VERSION, kör bench-node + smoke.mjs, bygg.

Mätvärden på servern (i5-10500, WASM, Manifold), 2026-10-16
  platta med 28 hål + sfär   13 416 tri    ~250 ms   (CGAL: ~70 s)
  kopp                       17 552 tri    ~120 ms
  tung, 144 sfärer          114 880 tri    ~1,8 s
  ny instans per rendering   ~35 ms
  Telefonens värden: data/bench.jsonl (från "Mät"-knappen), förlopp/fel i data/client.jsonl.

Telefonen (Chrome 155), 2026-10-16
  3D-vyn: 60 fps när tunga modellen (115k tri) snurrar.
  OpenSCAD plattan: 0,27 s med JIT – lika snabbt som servern; worker = huvudtråd.
  VIKTIGT: Chromes "JavaScript-optimering" (V8 optimizer) var avstängd för sidan
  → allt JS/WASM tolkades och blev ~18–30× långsammare (plattan 4,7 s, tung 33 s).
  Om det känns segt: kör diag.html (JS-loop ska ta ~20 ms, inte ~1300 ms) och
  tillåt JavaScript-optimering för sidan i Chrome. APK:ns WebView styr vi själva.
