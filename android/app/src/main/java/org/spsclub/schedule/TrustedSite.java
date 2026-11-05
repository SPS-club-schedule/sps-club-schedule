package org.spsclub.schedule;

import java.net.URI;

final class TrustedSite {
    static final String ORIGIN = "https://sps-club-schedule.github.io";
    static final String HOME = ORIGIN + "/sps-club-schedule/";
    static final String START = start("simple");
    static String start(String mode) {
        return HOME + ("full".equals(mode) ? "?mode=full#/mine" : "?mode=simple#/simple");
    }

    static boolean isPage(String value) {
        try {
            URI uri = new URI(value);
            // Only the app entry document runs inside the privileged WebView.
            // Archive attachments, even HTML/SVG, must never acquire this bridge.
            return "https".equals(uri.getScheme())
                && "sps-club-schedule.github.io".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getRawUserInfo() == null
                && ("/sps-club-schedule/".equals(uri.getRawPath())
                    || "/sps-club-schedule/index.html".equals(uri.getRawPath()));
        } catch (Exception ignored) { return false; }
    }

    static boolean isExternal(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && uri.getHost() != null
                && uri.getRawUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
}
