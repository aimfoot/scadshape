#!/bin/sh
# GitHub-release av Android-appen: bygger (android/build.sh), taggar v<version> och skapar en release
# på github.com/aimfoot/scadshape med APK:n, dess SHA-256 och signeringscertifikatets fingeravtryck.
#   tools/release.sh             allt (ren arbetskopia på main, pushad, taggen får inte finnas)
#   tools/release.sh --dry-run   bara bygg och visa releasetexten
# Releasetexten: android/release-notes/<version>.md (version = VERSION_NAME i android/build.sh).
# Token: en fine-grained GitHub-token med "Contents: Read and write" för bara det här förrådet, i
# ~/.config/scadshape/github-token (chmod 600). Den skrivs aldrig ut och hamnar inte på kommandoraden.
set -eu
cd "$(dirname "$0")/.."
REPO=aimfoot/scadshape
TOKEN_FILE=$HOME/.config/scadshape/github-token
APKSIGNER="$HOME/opt/android-build/jdk/bin/java -jar $HOME/opt/android-build/sdk/build-tools/36.0.0/lib/apksigner.jar"
DRY=0
[ "${1:-}" = --dry-run ] && DRY=1

VERSION=$(sed -n 's/^VERSION_NAME=//p' android/build.sh)
TAG=v$VERSION
NOTES=android/release-notes/$VERSION.md
[ -f "$NOTES" ] || { echo "Saknar $NOTES" >&2; exit 1; }
if [ "$DRY" = 0 ]; then
    [ -z "$(git status --porcelain)" ] || { echo "Arbetskopian är inte ren" >&2; exit 1; }
    [ "$(git branch --show-current)" = main ] || { echo "Inte på main" >&2; exit 1; }
    git fetch -q origin main
    [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main är inte pushad" >&2; exit 1; }
    if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then echo "$TAG finns redan" >&2; exit 1; fi
    [ -f "$TOKEN_FILE" ] || { echo "Saknar token: $TOKEN_FILE" >&2; exit 1; }
fi

android/build.sh
APK=scadshape-$VERSION.apk
cp android/dist/scadshape.apk "android/dist/$APK"
SHA=$(sha256sum "android/dist/$APK" | cut -d' ' -f1)
echo "$SHA  $APK" > "android/dist/$APK.sha256"
CERT=$($APKSIGNER verify --print-certs "android/dist/$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT
{
    cat "$NOTES"
    printf '\n---\n\n| | SHA-256 |\n|---|---|\n| `%s` | `%s` |\n| Signing certificate | `%s` |\n' "$APK" "$SHA" "$CERT"
} > "$BODY"
if [ "$DRY" = 1 ]; then
    echo "--- $TAG (torrkörning, inget laddas upp) ---"
    cat "$BODY"
    exit 0
fi

# Token bara i en tillfällig headerfil (chmod 600), aldrig som argument.
HDR=$(mktemp)
trap 'rm -f "$BODY" "$HDR"' EXIT
chmod 600 "$HDR"
printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\n' "$(cat "$TOKEN_FILE")" > "$HDR"

git tag -a "$TAG" -m "scadshape $VERSION"
git push -q origin "$TAG"
JSON=$(python3 -I -c 'import json, sys; print(json.dumps({"tag_name": sys.argv[1], "name": "scadshape " + sys.argv[2], "body": open(sys.argv[3]).read()}))' "$TAG" "$VERSION" "$BODY")
ID=$(curl -sSf -X POST -H @"$HDR" -d "$JSON" "https://api.github.com/repos/$REPO/releases" | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])')
for f in "$APK" "$APK.sha256"; do
    case $f in *.apk) TYPE=application/vnd.android.package-archive ;; *) TYPE=text/plain ;; esac
    curl -sSf -X POST -H @"$HDR" -H "Content-Type: $TYPE" --data-binary @"android/dist/$f" \
        "https://uploads.github.com/repos/$REPO/releases/$ID/assets?name=$f" >/dev/null
done
echo "https://github.com/$REPO/releases/tag/$TAG"
