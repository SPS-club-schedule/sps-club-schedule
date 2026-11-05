package org.spsclub.schedule;

import android.content.Context;
import android.content.SharedPreferences;

/** Device preference, deliberately independent of accounts and session expiry. */
final class DisplayMode {
    private final SharedPreferences preferences;
    DisplayMode(Context context) { preferences=context.getSharedPreferences("display-mode",Context.MODE_PRIVATE); }
    static boolean valid(String mode) { return "simple".equals(mode)||"full".equals(mode); }
    String get() { String mode=preferences.getString("mode","simple");return valid(mode)?mode:"simple"; }
    boolean set(String mode) { return valid(mode)&&preferences.edit().putString("mode",mode).commit(); }
}
