#!/bin/sh
# Samlar licenstexterna för allt som följer med appen i vendor/licenses/ (build.mjs kopierar dem till
# dist/licenses/, "Om scadshape" visar dem). Kör om när OpenSCAD-WASM:en eller ett beroende byts.
# OpenSCAD-WASM:ens beroenden och versioner: github.com/openscad/openscad-wasm, Makefile (*_REF).
set -eu
cd "$(dirname "$0")/../vendor/licenses"
SPDX=/usr/share/licenses/spdx   # Arch-paketet licenses

for id in GPL-2.0-or-later GPL-3.0-or-later LGPL-2.1-or-later LGPL-3.0-or-later MPL-2.0 Apache-2.0 BSL-1.0; do
    cp "$SPDX/$id.txt" "$id.txt"
done

GH=https://raw.githubusercontent.com
FD=https://gitlab.freedesktop.org
get() { # namn url
    curl -sSfL -o "$1.tmp" "$2"
    # En felsida (HTML) är ingen licens.
    if head -c 200 "$1.tmp" | grep -qi '<!doctype\|<html'; then echo "HTML från $2" >&2; rm "$1.tmp"; exit 1; fi
    mv "$1.tmp" "$1.txt"
    printf '%-20s %s\n' "$1" "$2" >> SOURCES.txt.new
}
: > SOURCES.txt.new
get openscad          $GH/openscad/openscad/04834adb1ba3c9a6e4160747c91cbadbce9c37b3/COPYING
get manifold          $GH/elalish/manifold/master/LICENSE
get clipper2          $GH/AngusJohnson/Clipper2/main/LICENSE
get cgal              $GH/CGAL/cgal/v6.0.3/Installation/LICENSE
get freetype          $GH/freetype/freetype/VER-2-14-3/docs/FTL.TXT
get harfbuzz          $GH/harfbuzz/harfbuzz/14.3.0/COPYING
get fontconfig        $FD/fontconfig/fontconfig/-/raw/2.18.2/COPYING
get libffi            $GH/libffi/libffi/v3.7.1/LICENSE
get cairo             $FD/cairo/cairo/-/raw/master/COPYING
get expat             $GH/libexpat/libexpat/R_2_8_2/expat/COPYING
get liblzma           $GH/kobolabs/liblzma/87b7682ce4b1c849504e2b3641cebaad62aaef87/COPYING
get libzip            $GH/nih-at/libzip/v1.11.4/LICENSE
get zlib              $GH/madler/zlib/v1.3.2/LICENSE
get libxml2           https://gitlab.gnome.org/GNOME/libxml2/-/raw/v2.15.3/Copyright
get double-conversion $GH/google/double-conversion/v3.4.0/LICENSE
get lib3mf            $GH/3MFConsortium/lib3mf/v2.3.2/LICENSE
get nlohmann-json     $GH/nlohmann/json/develop/LICENSE.MIT
{ echo "Hämtat $(date +%F). SPDX-texterna (GPL, LGPL, MPL, Apache, BSL) från $SPDX."; cat SOURCES.txt.new; } > SOURCES.txt
rm SOURCES.txt.new
ls
