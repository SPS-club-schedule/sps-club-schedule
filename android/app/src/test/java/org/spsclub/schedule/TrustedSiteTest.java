package org.spsclub.schedule;
import org.junit.Test;
import static org.junit.Assert.*;

public class TrustedSiteTest {
    @Test public void onlyEntryDocumentCanUseVault() {
        assertTrue(TrustedSite.isPage(TrustedSite.HOME));
        assertTrue(TrustedSite.isPage(TrustedSite.START));
        assertEquals(BuildConfig.SIMPLE_MODE, TrustedSite.START.endsWith("?mode=simple#/simple"));
        assertTrue(TrustedSite.isPage(TrustedSite.HOME + "?v=1#/board"));
        assertTrue(TrustedSite.isPage(TrustedSite.HOME + "index.html#/experience"));
        String[] blocked = {
            "http://sps-club-schedule.github.io/sps-club-schedule/",
            "https://sps-club-schedule.github.io.evil.test/sps-club-schedule/",
            "https://evil.test@sps-club-schedule.github.io/sps-club-schedule/",
            "https://sps-club-schedule.github.io:8443/sps-club-schedule/",
            TrustedSite.ORIGIN + "/other-project/", TrustedSite.HOME + "experience/evil.html",
            TrustedSite.HOME + "../other-project/", TrustedSite.HOME + "%2e%2e/",
            "file:///tmp/index.html", "javascript:alert(1)", "intent://example", "", null
        };
        for (String url : blocked) assertFalse(String.valueOf(url), TrustedSite.isPage(url));
    }
    @Test public void externalNavigationNeverUsesArbitraryIntents() {
        assertTrue(TrustedSite.isExternal("https://example.org/file.pdf"));
        for (String url : new String[]{"file:///test", "javascript:alert(1)", "http://example.org", "intent://test", "https://user@example.org"})
            assertFalse(TrustedSite.isExternal(url));
    }
}
