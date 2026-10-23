#!/bin/sh
# Bygger utan Gradle (som ~/opt/messenger-web). Verktygen ligger i ~/opt/android-build.
#   dist/scadshape.apk  installeras direkt (Taildrop), för test
#   dist/scadshape.aab  laddas upp till Play (signerad med uppladdningsnyckeln)
# Webbappen byggs till build/assets/www (inte ../dist, så webbversionen påverkas inte).
set -eu
cd "$(dirname "$0")"
VERSION_CODE=6
VERSION_NAME=0.3.2

B=$HOME/opt/android-build
export JAVA_HOME=$B/jdk PATH=$B/jdk/bin:$PATH
BT=$B/sdk/build-tools/36.0.0
JAR=$B/sdk/platforms/android-36/android.jar
BUNDLETOOL="java -jar $B/bundletool/bundletool.jar"
KS=signing/release.jks
ALIAS=scadshape

# En nyckel för alltid: uppdateringar installeras bara över en APK med samma nyckel.
if [ ! -f "$KS" ]; then
    mkdir -p signing && chmod 700 signing
    head -c 24 /dev/urandom | base64 > signing/password && chmod 600 signing/password
    keytool -genkeypair -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 3072 \
        -validity 36500 -dname "CN=scadshape" \
        -storepass:file signing/password -keypass:file signing/password
fi

rm -rf build && mkdir -p build/classes build/gen build/assets dist
(cd .. && SCADSHAPE_VERSION=$VERSION_NAME node build.mjs --out android/build/assets/www)
# Sådant som bara behövs på webben: förkomprimerat, service worker, diagnossidan, Pages-rubriker.
find build/assets/www \( -name '*.gz' -o -name 'sw.js' -o -name 'diag.*' -o -name '_headers' \) -delete

"$BT/aapt2" compile --dir res -o build/res.zip
link() {
    "$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml build/res.zip -A build/assets \
        --min-sdk-version 29 --target-sdk-version 36 \
        --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$@"
}
link -o build/base.apk --java build/gen --emit-ids build/ids.txt
# Samma resurser i protobuf-format (det bundletool läser), med samma resurs-id:n som R.java.
link -o build/proto.apk --proto-format --stable-ids build/ids.txt

javac -Xlint:all,-options -Werror --release 17 -classpath "$JAR" -d build/classes \
    $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 29 --lib "$JAR" --output build $(find build/classes -name '*.class')

# --- APK ---
python3 -I -c 'import zipfile; z = zipfile.ZipFile("build/base.apk", "a"); z.write("build/classes.dex", "classes.dex", zipfile.ZIP_DEFLATED); z.close()'
"$BT/zipalign" -p -f 4 build/base.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$ALIAS" --ks-pass file:signing/password --out dist/scadshape.apk build/aligned.apk
"$BT/apksigner" verify dist/scadshape.apk

# --- AAB: basmodulen = manifest/, dex/, res/, assets/, resources.pb ---
python3 -I - <<'EOF'
import zipfile
src = zipfile.ZipFile('build/proto.apk')
with zipfile.ZipFile('build/base-module.zip', 'w', zipfile.ZIP_DEFLATED) as out:
    for i in src.infolist():
        name = 'manifest/AndroidManifest.xml' if i.filename == 'AndroidManifest.xml' else i.filename
        out.writestr(name, src.read(i))
    out.write('build/classes.dex', 'dex/classes.dex')
EOF
$BUNDLETOOL build-bundle --modules=build/base-module.zip --output=build/unsigned.aab
# Play kräver jarsigner-signatur på AAB:n (apksigner signerar bara APK:er).
jarsigner -keystore "$KS" -storepass:file signing/password -keypass:file signing/password \
    -sigalg SHA256withRSA -digestalg SHA-256 -signedjar dist/scadshape.aab build/unsigned.aab "$ALIAS" >/dev/null
# (-strict passar inte: Android-nycklar är alltid självsignerade.)
jarsigner -verify dist/scadshape.aab | grep -q '^jar verified'
$BUNDLETOOL validate --bundle=dist/scadshape.aab >/dev/null

echo "dist/scadshape.apk ($VERSION_NAME, $(du -h dist/scadshape.apk | cut -f1))"
echo "dist/scadshape.aab ($VERSION_NAME, versionCode $VERSION_CODE, $(du -h dist/scadshape.aab | cut -f1))"
