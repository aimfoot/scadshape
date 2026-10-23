// Constants set by build.mjs (esbuild define).

/** The app's version; only set by android/build.sh (SCADSHAPE_VERSION), otherwise ''. */
declare const __APP_VERSION__: string;
/** Developer tools: the benchmark button and logging to the server. false in the app build – the code is then removed. */
declare const __DEV_TOOLS__: boolean;
