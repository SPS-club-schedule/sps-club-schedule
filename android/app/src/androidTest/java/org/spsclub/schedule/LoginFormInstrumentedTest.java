package org.spsclub.schedule;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LoginFormInstrumentedTest {
    private final Instrumentation instrument=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrument.getTargetContext();
    private final AtomicInteger status=new AtomicInteger(200),requests=new AtomicInteger();
    private MainActivity activity;
    private WebView web;
    private JSONObject session() throws Exception {
        return new JSONObject().put("token","c".repeat(64)).put("expiresAt",System.currentTimeMillis()+3600000)
            .put("user",new JSONObject().put("id","form-test").put("username","form_test"));
    }
    private void launchForm() throws Exception {
        android.net.ConnectivityManager network=(android.net.ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
        assertNull("Tests must stay offline; fixture passwords must never reach production",network.getActiveNetwork());
        activity=(MainActivity)instrument.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
        String page="<!doctype html><html><body><div id='app'><form data-form='auth'><input name='username' value='form_test'><input name='password' type='password' value='fictional-password-123'><button type='submit'>登录</button></form></div>"
            +"<script>window.formMarkup=document.querySelector('#app').innerHTML;"
            +"document.addEventListener('submit',event=>{event.preventDefault();window.finished=false;window.loginPromise=(async()=>{"
            +"const form=event.target;const response=await fetch('https://sps-schedule.folderrewind.top/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.elements.username.value,password:form.elements.password.value})});"
            +"const result=await response.json();if(response.ok&&result.ok){sessionStorage.setItem('sps-web-session',JSON.stringify(result.data));document.querySelector('#app').textContent='已登录';}"
            +"else{document.querySelector('#app').innerHTML=window.formMarkup;}window.finished=true;})().catch(()=>window.fetchFailed=true);});</script></body></html>";
        String response=new JSONObject().put("ok",true).put("data",session()).toString();
        String target=TrustedSite.HOME+"?form-test="+java.util.UUID.randomUUID();CountDownLatch ready=new CountDownLatch(1);
        instrument.runOnMainSync(()->{
            web.stopLoading();web.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                    if(request.isForMainFrame())return reply("text/html",200,page);
                    if(request.getUrl().toString().equals(LoginClient.ENDPOINT)){
                        if(request.getMethod().equals("OPTIONS"))return reply("application/json",200,"{}");
                        requests.incrementAndGet();return reply("application/json",status.get(),status.get()==200?response:"{\"ok\":false}");
                    }
                    return reply("text/plain",404,"");
                }
                @Override public void onPageFinished(WebView view,String url){if(target.equals(url))ready.countDown();}
            });web.loadUrl(target);
        });
        assertTrue(ready.await(10,TimeUnit.SECONDS));awaitJs("!!document.querySelector('[data-sps-remember]')");
    }
    private WebResourceResponse reply(String mime,int code,String body){
        Map<String,String> headers=new HashMap<>();headers.put("Access-Control-Allow-Origin",TrustedSite.ORIGIN);
        headers.put("Access-Control-Allow-Methods","POST,OPTIONS");headers.put("Access-Control-Allow-Headers","content-type");
        return new WebResourceResponse(mime,"UTF-8",code,code==200?"OK":"Failed",headers,new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
    private String js(String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);String[] value=new String[1];
        instrument.runOnMainSync(()->web.evaluateJavascript(script,result->{value[0]=result;done.countDown();}));
        assertTrue(done.await(5,TimeUnit.SECONDS));return value[0];
    }
    private void awaitJs(String script) throws Exception {
        long end=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<end){if("true".equals(js(script)))return;Thread.sleep(30);}
        fail("Expected page state: "+script);
    }
    private void finish(){if(activity!=null){instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();}}
    @Test public void ordinaryLoginSavesByDefaultAfterSuccessAndNeverSavesRejectedPassword() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();
        try {
            launchForm();assertEquals("true",js("document.querySelector('[data-sps-remember]').checked"));
            status.set(401);js("document.querySelector('form').requestSubmit()");awaitJs("window.finished === true");
            assertFalse(vault.credentials().has("password"));assertFalse(vault.read().has("session"));
            assertEquals("true",js("document.querySelector('[data-sps-remember]').checked"));
            status.set(200);js("document.querySelector('form').requestSubmit()");awaitJs("window.finished === true");
            long end=System.currentTimeMillis()+5000;while(!vault.credentials().has("password")&&System.currentTimeMillis()<end)Thread.sleep(30);
            assertEquals("fictional-password-123",vault.credentials().getString("password"));
            assertEquals("form-test",vault.read().getJSONObject("session").getJSONObject("user").getString("id"));
            assertEquals(2,requests.get());assertFalse(vault.read().toString().contains("fictional-password"));
            assertEquals("false",js("sessionStorage.getItem('sps-web-session').includes('fictional-password')"));
        } finally {finish();vault.clear();}
    }
    @Test public void optingOutSurvivesRerenderAndClearsOldPasswordOnSuccessfulLogin() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();
        vault.saveCredentials(new JSONObject().put("username","form_test").put("password","old-fictional-password").put("accountId","form-test"));
        try {
            launchForm();
            js("var box=document.querySelector('[data-sps-remember]');box.checked=false;box.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#app').innerHTML=window.formMarkup");
            awaitJs("document.querySelector('[data-sps-remember]')?.checked === false");
            js("document.querySelector('form').requestSubmit()");awaitJs("window.finished === true");
            long end=System.currentTimeMillis()+5000;while(vault.credentials().has("password")&&System.currentTimeMillis()<end)Thread.sleep(30);
            assertFalse(vault.credentials().has("password"));assertTrue(vault.read().has("session"));assertFalse(vault.mayAutoLogin());
            assertEquals(1,requests.get());
        } finally {finish();vault.clear();}
    }
}
