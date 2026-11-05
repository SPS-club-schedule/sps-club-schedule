package org.spsclub.schedule;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;

/** Signed APK resources on the existing HTTPS origin; API requests remain ordinary HTTPS. */
final class BundledFrontend {
    private final WebViewAssetLoader loader;
    BundledFrontend(Context context) throws Exception {
        Set<String> files=new HashSet<>();
        try(InputStream input=context.getAssets().open("frontend-manifest.json")) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
            while((n=input.read(buffer))!=-1)bytes.write(buffer,0,n);
            JSONArray entries=new JSONObject(bytes.toString("UTF-8")).getJSONArray("files");
            for(int i=0;i<entries.length();i++)files.add(entries.getJSONObject(i).getString("path"));
        }
        loader=new WebViewAssetLoader.Builder().setDomain("sps-club-schedule.github.io")
            .addPathHandler("/sps-club-schedule/",path->{
                String file=path.isEmpty()?"index.html":path;
                // Exact signed manifest membership prevents traversal, bridge-source
                // exposure and accidentally mixing downloaded JS with this release.
                if(!files.contains(file))return missing();
                try {
                    Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");
                    return new WebResourceResponse(mime(file),"UTF-8",200,"OK",
                        headers,
                        context.getAssets().open("web/"+file));
                } catch(Exception ignored){return missing();}
            }).build();
    }
    WebResourceResponse intercept(Uri url) {
        if(!"sps-club-schedule.github.io".equals(url.getHost()))return null;
        // Never fall back to GitHub Pages for an unavailable frontend resource.
        if(!"https".equals(url.getScheme())||url.getUserInfo()!=null||(url.getPort()!=-1&&url.getPort()!=443))return missing();
        WebResourceResponse response=loader.shouldInterceptRequest(url);
        return response!=null?response:missing();
    }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String path) {
        if(path.endsWith(".html"))return "text/html";
        if(path.endsWith(".js"))return "text/javascript";
        if(path.endsWith(".css"))return "text/css";
        if(path.endsWith(".json"))return "application/json";
        if(path.endsWith(".svg"))return "image/svg+xml";
        if(path.endsWith(".woff2"))return "font/woff2";
        if(path.endsWith(".woff"))return "font/woff";
        if(path.endsWith(".ttf"))return "font/ttf";
        if(path.endsWith(".png"))return "image/png";
        if(path.endsWith(".jpg")||path.endsWith(".jpeg"))return "image/jpeg";
        if(path.endsWith(".md")||path.endsWith(".txt")||path.endsWith(".tex"))return "text/plain";
        return "application/octet-stream";
    }
}
