#!/bin/sh
# GitHub release of the Android app: builds (android/build.sh), tags v<version> and creates a release
# on github.com/aimfoot/scadshape with the APK, its SHA-256 and the signing certificate's fingerprint.
#   tools/release.sh             everything (clean working copy on main, pushed, the tag must not exist)
#   tools/release.sh --dry-run   only build and show the release text
# The release text: android/release-notes/<version>.md (version = VERSION_NAME in android/build.sh).
# Token: a fine-grained GitHub token with "Contents: Read and write" for this repository only, in
# ~/.config/scadshape/github-token (chmod 600). It is never printed and never ends up on the command line.
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
[ -f "$NOTES" ] || { echo "Missing $NOTES" >&2; exit 1; }
if [ "$DRY" = 0 ]; then
    [ -z "$(git status --porcelain)" ] || { echo "The working copy is not clean" >&2; exit 1; }
    [ "$(git branch --show-current)" = main ] || { echo "Not on main" >&2; exit 1; }
    git fetch -q origin main
    [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not pushed" >&2; exit 1; }
    if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then echo "$TAG already exists" >&2; exit 1; fi
    [ -f "$TOKEN_FILE" ] || { echo "Missing token: $TOKEN_FILE" >&2; exit 1; }
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
    echo "--- $TAG (dry run, nothing is uploaded) ---"
    cat "$BODY"
    exit 0
fi

# The token only in a temporary header file (chmod 600), never as an argument.
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
