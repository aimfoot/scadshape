// Konstanter som build.mjs sätter (esbuild define).

/** Appens version; sätts bara av android/build.sh (SCADSHAPE_VERSION), annars ''. */
declare const __APP_VERSION__: string;
/** Utvecklarverktyg: mätknappen och loggning till servern. false i appbygget – koden tas då bort. */
declare const __DEV_TOOLS__: boolean;
