package org.spsclub.schedule;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionVault {
    private static final String ALIAS = "sps-session-v1";
    private final SharedPreferences prefs;
    SessionVault(Context context) { prefs = context.getSharedPreferences("session-vault", Context.MODE_PRIVATE); }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    static JSONObject sanitize(JSONObject input) throws Exception {
        JSONObject session = input.optJSONObject("session");
        if (session == null || session.optLong("expiresAt") <= System.currentTimeMillis()) return new JSONObject();
        String token = session.getString("token");
        JSONObject user = session.getJSONObject("user");
        if (!token.matches("[a-f0-9]{64}") || user.getString("id").length() > 128
            || user.getString("id").isEmpty() || user.getString("username").length() > 128)
            throw new IllegalArgumentException("Invalid session");
        JSONObject clean = new JSONObject().put("token", token).put("expiresAt", session.getLong("expiresAt"))
            .put("user", new JSONObject().put("id", user.getString("id")).put("username", user.getString("username")));
        String club = input.optString("clubId", "");
        if (club.length() > 128) throw new IllegalArgumentException("Invalid club");
        return new JSONObject().put("session", clean).put("clubId", club);
    }

    JSONObject read() {
        try {
            JSONObject state = sanitize(readEncrypted("payload"));
            if (!state.has("session")) remove("payload");
            return state;
        } catch (Exception ignored) { remove("payload"); return new JSONObject(); }
    }

    JSONObject write(JSONObject input) throws Exception {
        JSONObject clean = sanitize(input);
        if (!clean.has("session")) { remove("payload"); return clean; }
        writeEncrypted("payload",clean);
        return clean;
    }
    private JSONObject readEncrypted(String name) throws Exception {
        String payload=prefs.getString(name,null);
        if(payload==null)return new JSONObject();
        JSONObject envelope=new JSONObject(payload);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    private void writeEncrypted(String name,JSONObject clean) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String data = Base64.encodeToString(cipher.doFinal(clean.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        String envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("data", data).toString();
        if (!prefs.edit().putString(name, envelope).commit()) throw new IllegalStateException("Encrypted write failed");
    }
    JSONObject credentials() {
        try {
            JSONObject input=readEncrypted("credentials");
            if(input.length()==0)return input;
            return cleanCredentials(input);
        } catch(Exception ignored){clearCredentials();return new JSONObject();}
    }
    private JSONObject cleanCredentials(JSONObject input) throws Exception {
        String username=input.getString("username"),password=input.getString("password"),id=input.getString("accountId");
        if(!username.matches("[a-zA-Z0-9_]{3,30}") || password.length()<10 || password.length()>128 || id.isEmpty() || id.length()>128)
            throw new IllegalArgumentException("Invalid credentials");
        String club=input.optString("clubId","");if(club.length()>128)throw new IllegalArgumentException("Invalid club");
        return new JSONObject().put("username",username).put("password",password).put("accountId",id).put("clubId",club);
    }
    void saveCredentials(JSONObject input) throws Exception {writeEncrypted("credentials",cleanCredentials(input));}
    JSONObject rememberWebLogin(JSONObject input) throws Exception {
        JSONObject snapshot=sanitize(input),session=snapshot.optJSONObject("session");
        if(session==null)throw new IllegalArgumentException("Invalid login session");
        JSONObject user=session.getJSONObject("user");
        if(!input.getString("username").equalsIgnoreCase(user.getString("username")))throw new IllegalArgumentException("Account mismatch");
        JSONObject old=read(),saved=credentials();String id=user.getString("id"),club=snapshot.optString("clubId","");
        if(club.isEmpty() && old.optJSONObject("session")!=null && id.equals(old.getJSONObject("session").getJSONObject("user").getString("id")))club=old.optString("clubId","");
        else if(club.isEmpty() && id.equals(saved.optString("accountId")))club=saved.optString("clubId","");
        snapshot.put("clubId",club);
        if(input.getBoolean("remember"))saveCredentials(new JSONObject().put("username",user.getString("username"))
            .put("password",input.getString("password")).put("accountId",id).put("clubId",club));
        else clearCredentials();
        write(snapshot);delayAutoLogin(0);return snapshot;
    }
    void clearCredentials(){remove("credentials");remove("auto-retry-at");}
    boolean mayAutoLogin(){return credentials().has("password") && prefs.getLong("auto-retry-at",0)<=System.currentTimeMillis();}
    @android.annotation.SuppressLint("ApplySharedPref")
    void delayAutoLogin(long milliseconds){prefs.edit().putLong("auto-retry-at",System.currentTimeMillis()+milliseconds).commit();}
    @android.annotation.SuppressLint("ApplySharedPref")
    private void remove(String name){prefs.edit().remove(name).commit();}
    // Complete removal before a reload/process restart can read the old token.
    @android.annotation.SuppressLint("ApplySharedPref")
    void clear() { prefs.edit().clear().commit(); }
}
