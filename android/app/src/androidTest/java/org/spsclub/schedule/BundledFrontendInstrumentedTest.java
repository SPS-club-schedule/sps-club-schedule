package org.spsclub.schedule;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.webkit.WebView;
import android.webkit.WebResourceResponse;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class BundledFrontendInstrumentedTest {
    private final Instrumentation instrument=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrument.getTargetContext();
    private WebView web(MainActivity activity)throws Exception{
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);return (WebView)field.get(activity);
    }
    private String js(WebView view,String source)throws Exception{
        CountDownLatch done=new CountDownLatch(1);String[] result=new String[1];
        instrument.runOnMainSync(()->view.evaluateJavascript(source,value->{result[0]=value;done.countDown();}));
        assertTrue(done.await(5,TimeUnit.SECONDS));return result[0];
    }
    private void waitFor(WebView view,String condition)throws Exception{
        long end=SystemClock.elapsedRealtime()+15000;
        while(SystemClock.elapsedRealtime()<end){if("true".equals(js(view,condition)))return;Thread.sleep(50);}
        fail("Local frontend did not satisfy: "+condition+"; body: "+js(view,"document.body?.innerText"));
    }
    private MainActivity launch(){return (MainActivity)instrument.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
    private void close(MainActivity activity){instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();}
    @Test public void signedManifestAssetsWorkOfflineAndMissingAssetsNeverFallBackToRemotePages()throws Exception{
        BundledFrontend frontend=new BundledFrontend(context);
        WebResourceResponse html=frontend.intercept(Uri.parse(TrustedSite.START));assertEquals(200,html.getStatusCode());assertEquals("text/html",html.getMimeType());html.getData().close();
        for(String path:new String[]{"missing.js","session-bridge.js","../session-bridge.js","%2e%2e/session-bridge.js","downloads/SPS-Schedule-1.4.0.apk"}){
            assertEquals(path,404,frontend.intercept(Uri.parse(TrustedSite.HOME+path)).getStatusCode());
        }
        assertEquals(404,frontend.intercept(Uri.parse(TrustedSite.ORIGIN+"/other-repo/script.js")).getStatusCode());
        assertNull(frontend.intercept(Uri.parse(LoginClient.ENDPOINT)));
        assertNull(frontend.intercept(Uri.parse("https://sysu-phy-club-book.folderrewind.top/api/activities")));
    }
    @Test public void offlineColdStartShowsCalendarAndNativeModeChoiceSurvivesNewActivity()throws Exception{
        android.net.ConnectivityManager network=(android.net.ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
        assertNull("Use the isolated test emulator with networking disabled",network.getActiveNetwork());
        SessionVault vault=new SessionVault(context);vault.clear();DisplayMode mode=new DisplayMode(context);mode.set("simple");
        long started=SystemClock.elapsedRealtime();MainActivity first=launch();
        try{
            WebView view=web(first);waitFor(view,"!!document.querySelector('.simple-shell')");
            android.util.Log.i("SPSBundledTest","Offline cold start calendar ready in "+(SystemClock.elapsedRealtime()-started)+" ms");
            assertEquals("true",js(view,"!!document.querySelector('[data-action=\"simpleLogin\"]')"));
            assertEquals("false",js(view,"!!document.querySelector('[data-action=\"simpleFull\"],[data-action=\"simpleEnter\"],a[download]')"));
            assertEquals("false",js(view,"performance.getEntriesByType('resource').some(r=>/bootstrap\\.js|version\\.json|config\\.json/.test(r.name))"));
            js(view,"window.dispatchEvent(new CustomEvent('sps:select-mode',{detail:'full'}))");
            waitFor(view,"!!document.querySelector('form[data-form=\"auth\"]')");
            long end=SystemClock.elapsedRealtime()+5000;while(!"full".equals(mode.get())&&SystemClock.elapsedRealtime()<end)Thread.sleep(30);
            assertEquals("full",mode.get());assertEquals("false",js(view,"!!document.querySelector('.android-downloads')"));
        }finally{close(first);}
        MainActivity second=launch();
        try{
            WebView view=web(second);waitFor(view,"!!document.querySelector('form[data-form=\"auth\"]')");
            assertEquals("true",js(view,"location.hash.includes('next=%2Fmine')"));
            js(view,"window.dispatchEvent(new CustomEvent('sps:select-mode',{detail:'simple'}))");waitFor(view,"!!document.querySelector('.simple-shell')");
        }finally{close(second);mode.set("simple");vault.clear();}
    }
}
