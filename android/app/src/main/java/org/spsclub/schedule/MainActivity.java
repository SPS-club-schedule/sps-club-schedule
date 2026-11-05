package org.spsclub.schedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.EditText;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final int PICK_FILE = 20, SAVE_FILE = 21;
    private WebView web;
    private BundledFrontend frontend;
    private SessionVault vault;
    private ScriptHandler bridgeScript;
    private String bridgeSource;
    private ProgressBar progress;
    private LinearLayout cover;
    private TextView coverTitle, coverText;
    private Button retry;
    private boolean loadFailed;
    private boolean acceptNativeMessages = true;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingFile;
    private Button modeButton;
    private DisplayMode displayMode;
    private boolean loginBusy;
    private int loginGeneration;
    private final java.util.concurrent.ExecutorService loginExecutor=java.util.concurrent.Executors.newSingleThreadExecutor();
    private LoginClient loginClient=new LoginClient();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        vault = new SessionVault(this);
        displayMode = new DisplayMode(this);
        buildUi();
        try {
            try (java.io.InputStream input = getAssets().open("session-bridge.js")) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer,0,count);
                bridgeSource = bytes.toString("UTF-8");
            }
            frontend=new BundledFrontend(this);
            configureWebView();
            loadHome();
        } catch (Exception error) {
            showError("需要更新系统 WebView", "请先更新 Android System WebView 或 Chrome，然后重新打开 App。也可以从右上角用浏览器访问网站。");
            retry.setText("重新打开");
            retry.setOnClickListener(v -> recreate());
        }
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::navigateBack);
        }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(String text, int size, int color) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setTextColor(color); return view;
    }
    private void buildUi() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(245,247,242));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return android.os.Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(16),0,dp(4),0);
        TextView title = label("SPS  社团日程", 16, Color.rgb(36,85,64)); title.setTypeface(null, android.graphics.Typeface.BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1)); title.setGravity(Gravity.CENTER_VERTICAL);
        modeButton=new Button(this);modeButton.setTextSize(13);modeButton.setTextColor(Color.rgb(36,85,64));
        modeButton.setSingleLine(true);modeButton.setPadding(dp(4),0,dp(4),0);
        modeButton.setBackgroundColor(Color.TRANSPARENT);modeButton.setOnClickListener(v->showModeDialog());
        toolbar.addView(modeButton,new LinearLayout.LayoutParams(dp(112),dp(48)));updateModeButton();
        Button menu = new Button(this); menu.setText("⋮"); menu.setTextSize(22); menu.setContentDescription("App 选项");
        menu.setBackgroundColor(Color.TRANSPARENT); menu.setOnClickListener(this::showMenu);
        toolbar.addView(menu, new LinearLayout.LayoutParams(dp(48),dp(48))); root.addView(toolbar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1,dp(2)));
        FrameLayout content = new FrameLayout(this); root.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        web = new WebView(this); web.setBackgroundColor(Color.rgb(245,247,242)); content.addView(web,new FrameLayout.LayoutParams(-1,-1));
        cover = new LinearLayout(this); cover.setOrientation(LinearLayout.VERTICAL); cover.setGravity(Gravity.CENTER); cover.setPadding(dp(28),dp(24),dp(28),dp(24));
        cover.setBackgroundColor(Color.rgb(245,247,242));
        TextView mark = label("SPS", 44, Color.rgb(36,85,64)); mark.setTypeface(null, android.graphics.Typeface.BOLD); mark.setGravity(Gravity.CENTER); cover.addView(mark);
        coverTitle = label("正在打开社团日程",22,Color.rgb(30,55,43)); coverTitle.setGravity(Gravity.CENTER); coverTitle.setPadding(0,dp(20),0,dp(12)); cover.addView(coverTitle);
        coverText = label("先看公开日历，登录后安排自己的任务。",15,Color.rgb(90,110,99)); coverText.setGravity(Gravity.CENTER); cover.addView(coverText);
        retry = new Button(this); retry.setText("重新连接"); retry.setVisibility(View.GONE); retry.setOnClickListener(v -> loadHome());
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-2,dp(52)); button.topMargin=dp(24); cover.addView(retry,button);
        content.addView(cover,new FrameLayout.LayoutParams(-1,-1)); setContentView(root);
    }

    // The two WebView features are checked explicitly before installing the bridge.
    @SuppressLint({"SetJavaScriptEnabled", "RequiresFeature"})
    private void configureWebView() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) throw new IllegalStateException("Unsupported WebView");
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) throw new IllegalStateException("Unsupported WebView");
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " SPSSchedule/"+BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebViewCompat.addWebMessageListener(web,"SPSNative",Collections.singleton(TrustedSite.ORIGIN),
            (view,message,origin,isMainFrame,reply) -> {
                if (!acceptNativeMessages || !isMainFrame || !TrustedSite.ORIGIN.equals(origin.toString()) || !TrustedSite.isPage(view.getUrl())) return;
                try {
                    String data = message.getData();
                    if (data == null || data.length() > 3 * 1024 * 1024) return;
                    JSONObject input = new JSONObject(data);
                    switch (input.optString("type")) {
                        case "displayMode":
                            if(data.length()>128 || !DisplayMode.valid(input.optString("mode")))return;
                            if(!displayMode.set(input.getString("mode"))){toast("显示模式未能保存，请重试");return;}
                            updateModeButton();installSnapshot(vault.read());break;
                        case "session":
                            if (loginBusy || data.length() > 16384) return;
                            try { JSONObject snapshot=vault.write(input);syncSavedAccount(snapshot);installSnapshot(snapshot); }
                            catch (Exception error) {
                                vault.clear(); installSnapshot(new JSONObject());
                                toast("无法保存登录状态，本次退出后请重新登录");
                            }
                            break;
                        case "loginStarted": cancelLogin();break;
                        case "webLogin":
                            if(data.length()>16384)return;
                            cancelLogin();
                            try {installSnapshot(vault.rememberWebLogin(input));}
                            catch(Exception error){vault.clearCredentials();toast("本次登录可继续使用，但未能保存密码，请下次登录时重试");}
                            break;
                        case "signedOut":
                            cancelLogin();vault.clearCredentials();vault.write(new JSONObject());installSnapshot(new JSONObject());break;
                        case "credentialsChanged":
                            cancelLogin();
                            if(vault.credentials().has("password")){vault.clearCredentials();toast("密码已变更，下次正常登录时会自动保存新密码");}
                            break;
                        case "sessionExpired": maybeAutoLogin();break;
                        case "saveText": saveText(input); break;
                        case "download": openBrowser(input.optString("url")); break;
                        case "notice": toast(input.optString("text").substring(0, Math.min(150,input.optString("text").length()))); break;
                        default: break;
                    }
                } catch (Exception ignored) { toast("操作未完成，请重试"); }
            });
        installSnapshot(vault.read());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (request.isForMainFrame() && TrustedSite.isPage(url)) return false;
                if (request.isForMainFrame() && request.hasGesture()) openBrowser(url);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !TrustedSite.isPage(request.getUrl().toString()))
                    return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
                return frontend.intercept(request.getUrl());
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                if (!TrustedSite.isPage(url)) { view.stopLoading(); return; }
                loadFailed=false; progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view,String url) {
                CookieManager.getInstance().flush();
                if (!loadFailed && TrustedSite.isPage(url)) { cover.setVisibility(View.GONE); progress.setVisibility(View.INVISIBLE);maybeAutoLogin(); }
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error) {
                if (request.isForMainFrame()) showError("暂时无法连接", "请检查网络后重试。已保存的登录状态会保留；任务内容需要联网同步。");
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response) {
                if (request.isForMainFrame()) showError("网站暂时不可用", "请稍后重试，或从右上角在浏览器中打开。");
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) {
                handler.cancel(); showError("无法建立安全连接", "请检查手机日期和网络，然后重试。");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int value) { progress.setProgress(value); }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if (!TrustedSite.isPage(view.getUrl())) return false;
                if (fileCallback!=null) fileCallback.onReceiveValue(null);
                fileCallback=callback;
                try {
                    Intent pick = params.createIntent(); pick.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(pick,PICK_FILE); return true;
                } catch (Exception ignored) { fileCallback.onReceiveValue(null); fileCallback=null; toast("找不到文件选择器"); return true; }
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show(); return true;
            }
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result) { confirmJs(message,result); return true; }
            @Override public boolean onJsBeforeUnload(WebView view,String url,String message,JsResult result) { confirmJs("还有未保存的编辑，确定离开吗？",result); return true; }
        });
        web.setDownloadListener((url,userAgent,disposition,mime,length) -> openBrowser(url));
    }

    private void installSnapshot(JSONObject value) {
        try { value=new JSONObject(value.toString()).put("displayMode",displayMode.get()); }
        catch(Exception ignored){return;}
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        if (bridgeScript!=null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) bridgeScript.remove();
        bridgeScript=WebViewCompat.addDocumentStartJavaScript(web,bridgeSource.replace("__SPS_SNAPSHOT__",value.toString()),Collections.singleton(TrustedSite.ORIGIN));
    }
    private void confirmJs(String text,JsResult result) {
        new AlertDialog.Builder(this).setMessage(text).setPositiveButton("离开",(d,w)->result.confirm())
            .setNegativeButton("取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();
    }
    private void showError(String title,String text) {
        loadFailed=true; coverTitle.setText(title); coverText.setText(text); retry.setVisibility(View.VISIBLE);
        cover.setVisibility(View.VISIBLE); progress.setVisibility(View.INVISIBLE);
    }
    private void loadHome() {
        coverTitle.setText("正在打开社团日程");coverText.setText("先看日历，登录后安排自己的任务。");retry.setVisibility(View.GONE);
        web.loadUrl(TrustedSite.start(displayMode.get()));
    }
    private void maybeAutoLogin(){
        if(loginBusy||vault.read().has("session")||!vault.mayAutoLogin())return;
        android.net.ConnectivityManager manager=(android.net.ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        android.net.NetworkCapabilities network=manager.getNetworkCapabilities(manager.getActiveNetwork());
        if(network==null||!network.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET))return;
        JSONObject credentials=vault.credentials();vault.delayAutoLogin(60000);
        // The local UI is already usable. A slow password refresh must never
        // keep the guest calendar behind a loading cover.
        beginLogin(credentials.optString("username"),credentials.optString("password"),true,()->{},this::toast);
    }
    private void updateModeButton(){
        modeButton.setText("simple".equals(displayMode.get())?"极简模式 ▾":"完整模式 ▾");
        modeButton.setContentDescription("选择显示模式，当前"+("simple".equals(displayMode.get())?"极简模式":"完整模式"));
    }
    private void showModeDialog(){
        new AlertDialog.Builder(this).setTitle("显示模式")
            .setSingleChoiceItems(new String[]{"极简模式 · 先看日历","完整模式 · 登录后协作"},"simple".equals(displayMode.get())?0:1,(dialog,index)->{
                dialog.dismiss();String mode=index==0?"simple":"full";
                if(TrustedSite.isPage(web.getUrl())&&!loadFailed&&cover.getVisibility()!=View.VISIBLE){
                    // Let the website protect any unsaved form. It acknowledges
                    // accepted changes through the origin-restricted storage bridge.
                    web.evaluateJavascript("window.dispatchEvent(new CustomEvent('sps:select-mode',{detail:"+JSONObject.quote(mode)+"}))",null);
                }else if(displayMode.set(mode)){updateModeButton();installSnapshot(vault.read());loadHome();}
            }).setNegativeButton("取消",null).show();
    }
    private void syncSavedAccount(JSONObject snapshot) throws Exception {
        JSONObject credentials=vault.credentials(),session=snapshot.optJSONObject("session");
        if(session==null || !credentials.has("password"))return;
        JSONObject user=session.getJSONObject("user");
        if(!credentials.getString("accountId").equals(user.getString("id")))vault.clearCredentials();
        else vault.saveCredentials(credentials.put("username",user.getString("username")).put("clubId",snapshot.optString("clubId")));

    }
    private void showRememberDialog() {
        if(loginBusy){toast("正在登录，请稍候");return;}
        JSONObject saved=vault.credentials(),session=vault.read().optJSONObject("session");
        String username=saved.optString("username",session==null?"":session.optJSONObject("user").optString("username"));
        LinearLayout fields=new LinearLayout(this);fields.setOrientation(LinearLayout.VERTICAL);fields.setPadding(dp(24),dp(8),dp(24),0);
        TextView explanation=label("账号密码加密保存在这台手机上，会话到期时自动登录。主动退出登录会清除保存的信息。",14,Color.DKGRAY);fields.addView(explanation);
        EditText name=new EditText(this);name.setSingleLine(true);name.setHint("用户名");name.setText(username);name.setSaveEnabled(false);
        name.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);fields.addView(name);
        EditText password=new EditText(this);password.setSingleLine(true);password.setSaveEnabled(false);
        password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setHint(saved.has("password")?"留空使用已保存密码，或填写新密码":"密码（至少10个字符）");fields.addView(password);
        TextView error=label("",14,Color.rgb(150,45,45));fields.addView(error);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("登录与密码设置").setView(fields)
            .setPositiveButton("保存并登录",null).setNegativeButton("取消",null)
            .setNeutralButton("清除已存密码",(d,w)->{cancelLogin();vault.clearCredentials();toast("已清除保存的密码，当前登录仍可使用");}).create();
        dialog.setOnDismissListener(d->{password.setText("");if(loginBusy)cancelLogin();});
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String user=name.getText().toString().trim(),pass=password.getText().toString();
            if(pass.isEmpty() && user.equalsIgnoreCase(saved.optString("username")))pass=saved.optString("password");
            if(!user.matches("[a-zA-Z0-9_]{3,30}") || pass.length()<10 || pass.length()>128){error.setText("请输入有效用户名和10—128位密码");return;}
            error.setText("正在验证并保存…");dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            beginLogin(user,pass,false,dialog::dismiss,message->{error.setText(message);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);});
        }));
        dialog.show();
    }
    private void cancelLogin(){loginGeneration++;loginBusy=false;}
    private void beginLogin(String username,String password,boolean automatic,Runnable success,java.util.function.Consumer<String> failure) {
        if(loginBusy)return;
        loginBusy=true;final int ticket=++loginGeneration;
        loginExecutor.execute(()->{
            JSONObject session;try{session=loginClient.login(username,password);}
            catch(Exception error){
                runOnUiThread(()->{
                    if(!acceptNativeMessages || ticket!=loginGeneration)return;
                    loginBusy=false;
                    int status=error instanceof LoginClient.Failure?((LoginClient.Failure)error).status:0;
                    if(automatic && (status==400 || status==401 || status==403))vault.clearCredentials();
                    else if(status==429)vault.delayAutoLogin(15*60000);
                    else if(automatic)vault.delayAutoLogin(60000);

                    failure.accept(error instanceof LoginClient.Failure?error.getMessage():"连接失败，请联网后重试；已保存的信息会保留");
                });return;
            }
            runOnUiThread(()->{
                if(!acceptNativeMessages || ticket!=loginGeneration)return;
                try {
                    JSONObject old=vault.read(),saved=vault.credentials(),user=session.getJSONObject("user");
                    String id=user.getString("id"),club="";
                    if(old.optJSONObject("session")!=null && id.equals(old.getJSONObject("session").getJSONObject("user").getString("id")))club=old.optString("clubId","");
                    else if(id.equals(saved.optString("accountId")))club=saved.optString("clubId","");
                    // Stop the old document from overwriting the new session during recreation.
                    acceptNativeMessages=false;
                    vault.write(new JSONObject().put("session",session).put("clubId",club));
                    vault.saveCredentials(new JSONObject().put("username",user.getString("username")).put("password",password).put("accountId",id).put("clubId",club));
                    vault.delayAutoLogin(0);loginBusy=false;success.run();recreate();
                } catch(Exception error){
                    acceptNativeMessages=true;loginBusy=false;vault.clearCredentials();
                    failure.accept("未能加密保存登录信息，请重试");
                }
            });
        });
    }
    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this,anchor);
        menu.getMenu().add(0,1,0,"刷新页面"); menu.getMenu().add(0,2,1,"在浏览器中打开");
        menu.getMenu().add(0,3,2,"清除本机登录与缓存"); menu.getMenu().add(0,4,3,"关于 App");
        menu.getMenu().add(0,5,4,vault.credentials().has("password")?"自动登录 ✓ / 管理密码":"登录设置 / 管理自动登录");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    new AlertDialog.Builder(this).setMessage("刷新会丢失尚未保存的表单内容。确定刷新？")
                        .setPositiveButton("刷新",(d,w)->{if(loadFailed || !TrustedSite.isPage(web.getUrl()))loadHome();else web.reload();}).setNegativeButton("取消",null).show(); break;
                case 2: openBrowser(TrustedSite.isPage(web.getUrl())?web.getUrl():TrustedSite.HOME); break;
                case 3:
                    new AlertDialog.Builder(this).setMessage("清除这台手机保存的账号密码、登录与网站缓存。下次需要重新登录；服务器上的账号和任务不会删除。正常退出请使用网页中的“退出登录”。")
                        .setPositiveButton("清除",(d,w)->clearLocalData()).setNegativeButton("取消",null).show(); break;
                case 4:
                    new AlertDialog.Builder(this).setTitle("SPS 社团日程 "+BuildConfig.VERSION_NAME)
                        .setMessage("首次默认极简模式，可不登录浏览公开预约。顶部模式按钮可切换到完整模式，选择会在下次打开时保留。\n\n登录页默认勾选“记住密码”，登录成功后在本机加密保存账号密码。可以取消勾选；会话到期时自动登录，主动退出会清除保存的密码。右上角菜单中的“登录设置”可单独管理。\n\n页面、样式和脚本已内置，启动无需下载网页。先显示上次缓存的任务与公开预约，再联网更新。退出账号清除私人任务缓存；右上角清除本机登录与缓存可清除全部本机数据。修改界面需升级 App。\n\nAndroid 8.0 及以上，并需支持现代网页功能的系统 WebView。")
                        .setPositiveButton("知道了",null).show(); break;
                case 5: showRememberDialog();break;
                default: break;
            }
            return true;
        }); menu.show();
    }
    private void clearLocalData() {
        cancelLogin();
        acceptNativeMessages=false;
        web.stopLoading();
        // Remove the native receiver before abandoning the old document, so its
        // queued storage messages cannot put the cleared token back.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(web,"SPSNative");
        if (bridgeScript!=null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) bridgeScript.remove();
        vault.clear(); WebStorage.getInstance().deleteAllData(); web.clearCache(true); web.clearHistory();
        CookieManager.getInstance().removeAllCookies(result -> { CookieManager.getInstance().flush(); recreate(); });
    }
    private void openBrowser(String url) {
        if (!TrustedSite.isExternal(url)) { toast("请在网站中打开该内容"); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (Exception ignored) { toast("没有可打开该链接的浏览器"); }
    }
    private void saveText(JSONObject input) throws Exception {
        if (pendingFile!=null) { toast("请先完成上一个文件的保存"); return; }
        byte[] bytes=input.getString("text").getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 2*1024*1024) { toast("文件过大，请从浏览器导出"); return; }
        String name=input.optString("name","SPS-export.txt").replaceAll("[\\\\/\\p{Cntrl}]","_");
        if (name.isEmpty()) name="SPS-export.txt";
        if (name.length()>160) name=name.substring(name.length()-160);
        String mime="text/calendar".equals(input.optString("mime"))?"text/calendar":"text/plain";
        Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,name);
        pendingFile=bytes;
        try { startActivityForResult(save,SAVE_FILE); }
        catch (Exception error) { pendingFile=null; toast("找不到文件保存器"); }
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request==PICK_FILE && fileCallback!=null) {
            Uri[] selected=WebChromeClient.FileChooserParams.parseResult(result,data);
            // Only user-selected content providers; never filesystem/file:// URIs.
            if (selected!=null) for (Uri uri:selected) if (!"content".equals(uri.getScheme())) { selected=null; break; }
            fileCallback.onReceiveValue(selected); fileCallback=null;
        }
        if (request==SAVE_FILE) {
            byte[] bytes=pendingFile; pendingFile=null;
            if (result==RESULT_OK && data!=null && data.getData()!=null && bytes!=null && "content".equals(data.getData().getScheme())) {
                try (OutputStream output=getContentResolver().openOutputStream(data.getData())) {
                    if (output==null) throw new IllegalStateException();
                    output.write(bytes); toast("文件已保存");
                } catch (Exception ignored) { toast("保存失败，请重新导出"); }
            }
        }
    }
    private void toast(String message) { Toast.makeText(this,message,Toast.LENGTH_LONG).show(); }
    private void navigateBack() { if (web.canGoBack()) web.goBack(); else moveTaskToBack(true); }
    // Android 13+ gestures use the OnBackInvokedDispatcher registered in onCreate.
    // This override is the fallback for Android 8–12's buttons/gestures only.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { navigateBack(); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web!=null) web.onResume(); }
    @Override protected void onDestroy() {
        cancelLogin();loginExecutor.shutdownNow();
        acceptNativeMessages=false;
        if (fileCallback!=null) fileCallback.onReceiveValue(null);
        if (bridgeScript!=null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) bridgeScript.remove();
        if (web.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup)web.getParent()).removeView(web);
        web.destroy(); super.onDestroy();
    }
}
