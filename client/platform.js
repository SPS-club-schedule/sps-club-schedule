// Compile-time platform choice: website and signed APK share business code.
export const bundledApp=typeof __BUNDLED_APP__!=='undefined'&&__BUNDLED_APP__;
export const bundledConfig=typeof __BUNDLED_CONFIG__!=='undefined'?__BUNDLED_CONFIG__:null;
