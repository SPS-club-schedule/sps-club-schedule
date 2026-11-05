package org.spsclub.schedule;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

// Passwords never enter the WebView/bridge. Only this fixed HTTPS endpoint receives them.
class LoginClient {
    static final String ENDPOINT="https://sps-schedule.folderrewind.top/auth/login";
    interface Connections { HttpURLConnection open() throws Exception; }
    private final Connections connections;
    LoginClient(){this(()->(HttpURLConnection)new URL(ENDPOINT).openConnection());}
    LoginClient(Connections connections){this.connections=connections;}
    static class Failure extends Exception {
        final int status;
        Failure(int status,String message){super(message);this.status=status;}
    }
    JSONObject login(String username,String password) throws Exception {
        HttpURLConnection connection=connections.open();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);connection.setReadTimeout(20000);
            connection.setUseCaches(false);connection.setRequestMethod("POST");connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setRequestProperty("Accept","application/json");
            byte[] body=new JSONObject().put("username",username).put("password",password).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream output=connection.getOutputStream()){output.write(body);}
            int status=connection.getResponseCode();
            if(status>=300 && status<400)throw new Failure(status,"登录地址发生跳转，请更新 App 后重试");
            if(status==400 || status==401 || status==403)throw new Failure(status,"用户名或密码不正确，请重新输入");
            if(status==429)throw new Failure(status,"尝试次数较多，请15分钟后重试");
            if(status!=200)throw new Failure(status,"登录服务暂时不可用，请稍后重试");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            try(InputStream input=connection.getInputStream()){
                byte[] buffer=new byte[2048];int count;
                while((count=input.read(buffer))!=-1){if(bytes.size()+count>16384)throw new Failure(0,"登录响应异常");bytes.write(buffer,0,count);}
            }
            JSONObject result=new JSONObject(bytes.toString("UTF-8"));
            if(!result.optBoolean("ok"))throw new Failure(0,"登录未成功，请重试");
            JSONObject session=SessionVault.sanitize(new JSONObject().put("session",result.getJSONObject("data"))).optJSONObject("session");
            if(session==null || !username.equalsIgnoreCase(session.getJSONObject("user").getString("username")))throw new Failure(0,"登录响应异常");
            return session;
        } finally {connection.disconnect();}
    }
}
