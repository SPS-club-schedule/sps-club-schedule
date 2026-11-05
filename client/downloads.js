import {bundledApp} from './platform';
export const androidVersion='1.5.0';
export const androidPackage='./downloads/SPS-Schedule-'+androidVersion;
export const androidDownloads=bundledApp?'':`<div class="android-downloads"><div><a class="secondary compact" href="${androidPackage}.apk" download>下载安卓 App</a>
<a class="plain small" href="${androidPackage}.zip" download>微信分享包（ZIP）</a></div><p class="hint">v${androidVersion} · 极简 / 完整模式自由切换 · Android 8.0 及以上</p></div>`;
