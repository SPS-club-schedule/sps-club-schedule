package org.spsclub.schedule;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class RememberedLoginTest {
    private final Instrumentation instrument=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrument.getTargetContext();
    private JSONObject session() throws Exception {
        return new JSONObject().put("token","b".repeat(64)).put("expiresAt",System.currentTimeMillis()+3600000)
            .put("user",new JSONObject().put("id","remember-test").put("username","remember_test"));
    }
    private JSONObject credentials() throws Exception {
        return new JSONObject().put("username","remember_test").put("password","fictional-password-123")
            .put("accountId","remember-test").put("clubId","test-club");
    }
    @Test public void credentialsAreEncryptedIndependentOfSessionExpiryAndNeverInWebSnapshot() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();
        try {
            vault.write(new JSONObject().put("session",session()));vault.saveCredentials(credentials());
            String disk=context.getSharedPreferences("session-vault",0).getString("credentials","");
            assertFalse(disk.contains("fictional-password-123"));assertFalse(disk.contains("remember_test"));
            assertFalse(vault.read().toString().contains("password"));
            vault.write(new JSONObject().put("session",session().put("expiresAt",1)));
            assertFalse(vault.read().has("session"));assertEquals("fictional-password-123",new SessionVault(context).credentials().getString("password"));
            assertTrue(vault.mayAutoLogin());vault.delayAutoLogin(60000);assertFalse(new SessionVault(context).mayAutoLogin());
            vault.write(new JSONObject().put("session",session()));vault.clearCredentials();
            assertTrue(vault.read().has("session"));assertFalse(vault.mayAutoLogin());
            vault.saveCredentials(credentials());vault.clear();assertFalse(vault.read().has("session"));assertEquals(0,vault.credentials().length());
        } finally {vault.clear();}
    }
    private static class Connection extends HttpURLConnection {
        final int status;final String response;final ByteArrayOutputStream sent=new ByteArrayOutputStream();boolean closed;
        Connection(int status,String response) throws Exception {super(new URL(LoginClient.ENDPOINT));this.status=status;this.response=response;}
        @Override public void connect(){}
        @Override public void disconnect(){closed=true;}
        @Override public boolean usingProxy(){return false;}
        @Override public int getResponseCode(){return status;}
        @Override public OutputStream getOutputStream(){return sent;}
        @Override public InputStream getInputStream(){return new ByteArrayInputStream(response.getBytes(StandardCharsets.UTF_8));}
    }
    @Test public void nativeLoginUsesPostWithoutRedirectsAndValidatesResponses() throws Exception {
        Connection connection=new Connection(200,new JSONObject().put("ok",true).put("data",session()).toString());
        JSONObject result=new LoginClient(()->connection).login("remember_test","fictional-password-123");
        assertEquals("remember-test",result.getJSONObject("user").getString("id"));assertEquals("POST",connection.getRequestMethod());
        assertFalse(connection.getInstanceFollowRedirects());assertTrue(connection.closed);
        assertEquals("fictional-password-123",new JSONObject(connection.sent.toString("UTF-8")).getString("password"));
        for(int status:new int[]{302,401,429,500}){
            Connection failed=new Connection(status,"{}");
            try {new LoginClient(()->failed).login("remember_test","fictional-password-123");fail("Expected failure");}
            catch(LoginClient.Failure e){assertEquals(status,e.status);assertFalse(e.getMessage().contains("fictional-password"));}
            assertTrue(failed.closed);assertFalse(failed.getInstanceFollowRedirects());
        }
        Connection wrongAccount=new Connection(200,new JSONObject().put("ok",true).put("data",session()).toString());
        try{new LoginClient(()->wrongAccount).login("different_user","fictional-password-123");fail("Mismatched account");}catch(LoginClient.Failure expected){}
    }
    private MainActivity launchOffline() {
        android.net.ConnectivityManager manager=(android.net.ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
        assertNull("Run credential tests with emulator networking disabled; test secrets must never reach production",manager.getActiveNetwork());
        return (MainActivity)instrument.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void inject(MainActivity activity,LoginClient client) throws Exception {
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("loginClient");field.setAccessible(true);field.set(activity,client);
    }
    private void begin(MainActivity activity,boolean automatic,Runnable success,Consumer<String> failure) throws Exception {
        java.lang.reflect.Method method=MainActivity.class.getDeclaredMethod("beginLogin",String.class,String.class,boolean.class,Runnable.class,Consumer.class);method.setAccessible(true);
        instrument.runOnMainSync(()->{try{method.invoke(activity,"remember_test","fictional-password-123",automatic,success,failure);}catch(Exception error){throw new RuntimeException(error);}});
    }
    @Test public void automaticLoginCreatesFreshSessionAndRetainsSavedPasswordAcrossRecreation() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();MainActivity activity=launchOffline();MainActivity recreated=null;
        Instrumentation.ActivityMonitor monitor=instrument.addMonitor(MainActivity.class.getName(),null,false);
        CountDownLatch complete=new CountDownLatch(1);String[] error=new String[1];
        try {
            vault.saveCredentials(credentials());
            JSONObject response=session();inject(activity,new LoginClient(){@Override JSONObject login(String u,String p){return response;}});
            begin(activity,true,complete::countDown,message->{error[0]=message;complete.countDown();});
            assertTrue(complete.await(5,TimeUnit.SECONDS));assertNull(error[0]);
            recreated=(MainActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull("Activity recreated with fresh session",recreated);
            assertEquals("remember-test",vault.read().getJSONObject("session").getJSONObject("user").getString("id"));
            assertEquals("test-club",vault.read().getString("clubId"));assertEquals("fictional-password-123",vault.credentials().getString("password"));
        } finally {
            instrument.removeMonitor(monitor);MainActivity next=recreated;
            instrument.runOnMainSync(()->{activity.finish();if(next!=null)next.finish();});instrument.waitForIdleSync();vault.clear();
        }
    }
    @Test public void badSavedPasswordStopsRetriesAndRateLimitKeepsSecretWithCooldown() throws Exception {
        SessionVault vault=new SessionVault(context);vault.clear();MainActivity activity=launchOffline();
        try {
            for(int status:new int[]{401,429,500}){
                vault.saveCredentials(credentials());
                inject(activity,new LoginClient(){@Override JSONObject login(String u,String p) throws Exception {throw new Failure(status,"Test login failed");}});
                CountDownLatch done=new CountDownLatch(1);begin(activity,true,()->fail("Unexpected success"),message->done.countDown());
                assertTrue(done.await(5,TimeUnit.SECONDS));assertFalse(vault.mayAutoLogin());
                assertEquals(status!=401,vault.credentials().has("password"));assertFalse(vault.read().has("session"));
            }
        } finally {instrument.runOnMainSync(activity::finish);instrument.waitForIdleSync();vault.clear();}
    }
}
