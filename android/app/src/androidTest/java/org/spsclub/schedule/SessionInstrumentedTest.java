package org.spsclub.schedule;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SessionInstrumentedTest {
    private final Instrumentation instrument=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrument.getTargetContext();
    private JSONObject sample() throws Exception {
        return new JSONObject().put("session",new JSONObject().put("token","a".repeat(64))
            .put("expiresAt",System.currentTimeMillis()+3600000)
            .put("user",new JSONObject().put("id","test-native").put("username","native_test"))).put("clubId","club-test");
    }
    private WebView web(MainActivity activity) throws Exception {
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);return (WebView)field.get(activity);
    }
    private MainActivity launch() {
        return (MainActivity)instrument.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void loadControlledPage(WebView web) throws Exception {
        CountDownLatch loaded=new CountDownLatch(1);
        String target=TrustedSite.HOME+"?native-test="+java.util.UUID.randomUUID();
        instrument.runOnMainSync(()->{
            web.stopLoading();
            web.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                    return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream("<!doctype html><html><body>Native integration test</body></html>".getBytes(StandardCharsets.UTF_8)));
                }
                @Override public void onPageFinished(WebView view,String url){
                    if(target.equals(url)) view.evaluateJavascript("document.body && document.body.textContent === 'Native integration test'",value->{if("true".equals(value))loaded.countDown();});
                }
            });
            web.loadUrl(target);
        });
        assertTrue("Controlled page loaded",loaded.await(15,TimeUnit.SECONDS));
    }
    private String js(WebView web,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);String[] result=new String[1];
        instrument.runOnMainSync(()->web.evaluateJavascript(script,value->{result[0]=value;done.countDown();}));
        assertTrue(done.await(5,TimeUnit.SECONDS));instrument.waitForIdleSync();return result[0];
    }
    private void awaitStored(boolean present) throws Exception {
        long deadline=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<deadline){
            if(new SessionVault(context).read().has("session")==present)return;
            Thread.sleep(30);
        }
        fail("Native persistence did not settle");
    }
    @Test public void encryptedVaultRoundtripAndCorruption() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();
        JSONObject input=sample();input.getJSONObject("session").put("password","never-save");
        vault.write(input);
        String disk=context.getSharedPreferences("session-vault",0).getString("payload","");
        assertFalse(disk.contains("a".repeat(64)));assertFalse(disk.contains("native_test"));assertFalse(disk.contains("never-save"));
        assertEquals("club-test",new SessionVault(context).read().getString("clubId"));
        context.getSharedPreferences("session-vault",0).edit().putString("payload","corrupted").commit();
        assertFalse(vault.read().has("session"));
        input.getJSONObject("session").put("expiresAt",1);vault.write(input);assertFalse(vault.read().has("session"));vault.clear();
    }
    @Test public void loginSurvivesNewActivityAndLogoutStaysCleared() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();
        MainActivity first=launch();
        try {
            WebView view=web(first);loadControlledPage(view);
            assertEquals("Bridge installed before page code", "true", js(view,"window.__spsAndroidInstalled === true"));
            String session=JSONObject.quote(sample().getJSONObject("session").toString());
            js(view,"sessionStorage.setItem('sps-web-session',"+session+");sessionStorage.setItem('sps-web-club:test-native','club-test')");
            awaitStored(true);
        } finally {instrument.runOnMainSync(first::finish);instrument.waitForIdleSync();}
        MainActivity second=launch();
        try {
            WebView view=web(second);loadControlledPage(view);
            assertEquals("\"native_test\"",js(view,"JSON.parse(sessionStorage.getItem('sps-web-session')).user.username"));
            assertEquals("\"club-test\"",js(view,"sessionStorage.getItem('sps-web-club:test-native')"));
            js(view,"sessionStorage.removeItem('sps-web-session')");awaitStored(false);
            loadControlledPage(view);assertEquals("null",js(view,"sessionStorage.getItem('sps-web-session')"));
        } finally {instrument.runOnMainSync(second::finish);instrument.waitForIdleSync();vault.clear();}
    }
    @Test public void subframeCannotEraseTopLevelSession() throws Exception {
        SessionVault vault=new SessionVault(context);vault.write(sample());
        vault.saveCredentials(new JSONObject().put("username","native_test").put("password","fictional-password-123").put("accountId","test-native"));
        MainActivity activity=launch();
        try {
            WebView view=web(activity);loadControlledPage(view);
            js(view,"var f=document.createElement('iframe');f.srcdoc='<script>SPSNative.postMessage(JSON.stringify({type:\"session\",session:null}));SPSNative.postMessage(JSON.stringify({type:\"signedOut\"}));window.top.__frameAttempted=true<\\/script>';document.body.append(f)");
            long deadline=System.currentTimeMillis()+5000;
            while(System.currentTimeMillis()<deadline && !"true".equals(js(view,"window.__frameAttempted === true"))) Thread.sleep(30);
            assertEquals("true",js(view,"window.__frameAttempted === true"));
            instrument.waitForIdleSync();assertTrue(vault.read().has("session"));assertTrue(vault.credentials().has("password"));
        } finally {instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();vault.clear();}
    }
    @Test public void trustedLogoutErasesSavedPasswordAndPasswordChangeKeepsCurrentSession() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();vault.write(sample());MainActivity activity=launch();
        try {
            WebView view=web(activity);loadControlledPage(view);
            JSONObject credentials=new JSONObject().put("username","native_test").put("password","fictional-password-123").put("accountId","test-native");
            vault.saveCredentials(credentials);js(view,"SPSNative.postMessage(JSON.stringify({type:'credentialsChanged'}))");
            long deadline=System.currentTimeMillis()+5000;
            while(vault.credentials().has("password") && System.currentTimeMillis()<deadline)Thread.sleep(30);
            assertFalse(vault.credentials().has("password"));assertTrue(vault.read().has("session"));
            vault.saveCredentials(credentials);js(view,"SPSNative.postMessage(JSON.stringify({type:'signedOut'}));sessionStorage.removeItem('sps-web-session')");
            awaitStored(false);assertFalse(vault.credentials().has("password"));assertFalse(vault.mayAutoLogin());
        } finally {instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();vault.clear();}
    }
    @Test public void calendarBlobOpensSystemSaveDialog() throws Exception {
        MainActivity activity=launch();CountDownLatch save=new CountDownLatch(1);String[] details=new String[2];
        Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){
            @Override public Instrumentation.ActivityResult onStartActivity(Intent intent){
                if(Intent.ACTION_CREATE_DOCUMENT.equals(intent.getAction())){
                    details[0]=intent.getType();details[1]=intent.getStringExtra(Intent.EXTRA_TITLE);save.countDown();
                    return new Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);
                }
                return null;
            }
        };
        try {
            WebView view=web(activity);loadControlledPage(view);instrument.addMonitor(monitor);
            js(view,"var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['BEGIN:VCALENDAR\\r\\nEND:VCALENDAR'],{type:'text/calendar;charset=utf-8'}));a.download='SPS-test.ics';a.click()");
            assertTrue("Native save dialog opened",save.await(5,TimeUnit.SECONDS));
            assertEquals("text/calendar",details[0]);assertEquals("SPS-test.ics",details[1]);
        } finally {instrument.removeMonitor(monitor);instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();}
    }
}
