package app.mysecondself;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Turnstile is hosted on synqme.mysecondself.app in an embedded frame.
        // Android WebView must allow cookies used by Cloudflare's challenge.
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                CookieManager cookies = CookieManager.getInstance();
                cookies.setAcceptCookie(true);
                cookies.setAcceptThirdPartyCookies(webView, true);
                webView.getSettings().setJavaScriptEnabled(true);
                webView.getSettings().setDomStorageEnabled(true);
            }
        }
    }
}
