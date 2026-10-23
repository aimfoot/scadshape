scadshape for Android – wrapper (started 2026-10-22)
====================================================

The web app (the ../dist build) in a WebView, fully offline. Built without Gradle.

  ./build.sh            → dist/scadshape.apk (for testing and GitHub releases) and dist/scadshape.aab (for Play)
                          (builds the web app into build/assets/www, not ../dist)
  adb install dist/scadshape.apk   (or copy the APK to the phone some other way)

AAB (2026-10-22): the same compilation as the APK. aapt2 links once more in protobuf format with
the same resource ids (--emit-ids/--stable-ids), the base module (manifest/, dex/, res/, assets/,
resources.pb) is packed into an AAB with bundletool (~/opt/android-build/bundletool, 1.18.3 from
github.com/google/bundletool, sha256 checked) and signed with jarsigner (SHA256withRSA).
build.sh runs bundletool validate. Checked: a universal APK that bundletool builds from the AAB has
the same files, dex and certificate as the APK; only bundletool's metadata in the manifest differs.
Download size from Play ≈ 5.4 MB (bundletool get-size).
Play App Signing (chosen when the app is created in Play Console):
  a) Google creates the app's signing key, and release.jks becomes only the upload key. Then an
     APK from here cannot be installed over the Play version (different signature).
  b) release.jks is uploaded as the app's signing key (Google's PEPK tool) and a separate
     upload key is created. Then APKs from here (GitHub/Obtainium/F-Droid) and the Play version
     are interchangeable.

Version: VERSION_CODE/VERSION_NAME in build.sh – bump VERSION_CODE for every release.
signing/ = the key. If it is lost, updates cannot be installed over the app (keep a copy).
Package name io.github.aimfoot.scadshape (final since 0.3.1, 2026-10-22, the first public
release). It cannot be changed: a different package name is a different app.
Releases: ../tools/release.sh (GitHub release with the APK and SHA-256, see the script's header).

No permissions at all, not even INTERNET (0.2.0, works on the phone 2026-10-22).
The models are kept in IndexedDB (src/kv.ts, since 2026-10-22) in the WebView's data, which Android's
automatic backup includes (allowBackup="true"). When the app is updated over an older version, the
models are moved from localStorage at the first start.

How it works (src/io/github/aimfoot/scadshape/)
  MainActivity  The files are served from https://appassets.androidplatform.net/ out of assets/www
                (a secure origin: WASM, workers and IndexedDB work as on the web). All other
                addresses get 403 – the app never uses the network. Outgoing links open in the browser.
                Edge to edge with padding for the system and keyboard bars.
                The bridge window.ScadshapeAndroid:
                  saveFile  → Downloads (MediaStore, no permission needed from Android 10)
                  shareFile → the share sheet (cache/share/<name> via Files, only the latest share)
                  setBars   → the system bars' color/icons follow the app's theme
                  takeFile  → a file that another app opened/shared here (VIEW/SEND)
                Back: the page closes the topmost dialog/panel/sketch mode (src/ui/android.ts back());
                nothing open → the app goes to the background.
                Toasts come from res/values/strings.xml (English) and res/values-sv/ (Swedish),
                so they follow the phone's language.
  Files         ContentProvider for shared files (not exported, read access per share).
The page side: src/android.ts (the bridge) and src/ui/android.ts. In a browser there is no bridge and
everything works as before. The service worker is not registered in the app.
The app build (SCADSHAPE_VERSION set) has __DEV_TOOLS__ = false (src/globals.d.ts): the benchmark button
and all code that sends logs/benchmarks to the server (api/log, api/bench, the server's address) are
removed during minification. Check: grep for "api/" in build/assets/www/*.js should give zero hits.

Test
  tools/browser/android.mjs – a fake bridge against the app's own files (see the file's header). Checks
  the file at start, save/share 3MF, back, sketch mode, a shared STL, dark theme, no service worker.
  The real test = on the phone.

Left before Play
  Choose Play App Signing a/b (see above).
  The GPL requires the source code of the OpenSCAD engine to be available: "About" points to
  github.com/openscad/openscad + openscad-wasm; preferably keep an own copy of the source code for the
  snapshot in vendor/openscad (2026.10.15) when the app is released.
Source code: https://github.com/aimfoot/scadshape (public 2026-10-22, the link in "About").
