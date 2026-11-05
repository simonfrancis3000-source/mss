package app.mysecondself;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens Samsung's read-only SmartThings OAuth flow in the system browser.
 * No Samsung tokens or user credentials enter the native Android bridge.
 */
@CapacitorPlugin(name = "MSSSmartThings")
public class MSSSmartThingsPlugin extends Plugin {
    @PluginMethod
    public void openAuthorization(PluginCall call) {
        String value = call.getString("url");
        if (value == null) {
            call.reject("Missing SmartThings authorisation URL.");
            return;
        }
        Uri target;
        try {
            target = Uri.parse(value);
        } catch (Exception exception) {
            call.reject("Invalid SmartThings authorisation URL.");
            return;
        }
        if (!"https".equals(target.getScheme()) ||
                !"api.smartthings.com".equals(target.getHost()) ||
                !"/v1/oauth/authorize".equals(target.getPath()) ||
                target.getQueryParameter("state") == null) {
            call.reject("Unrecognised SmartThings authorisation address.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent browser = new Intent(Intent.ACTION_VIEW, target);
                browser.addCategory(Intent.CATEGORY_BROWSABLE);
                getActivity().startActivity(browser);
                call.resolve();
            } catch (ActivityNotFoundException exception) {
                call.reject("No browser is available for SmartThings authorisation.");
            } catch (Exception exception) {
                call.reject("SmartThings authorisation could not open.");
            }
        });
    }

    @PluginMethod
    public void consumeRedirect(PluginCall call) {
        String outcome = "";
        Intent intent = getActivity().getIntent();
        Uri data = intent == null ? null : intent.getData();
        if (data != null && "app.mysecondself".equals(data.getScheme()) &&
                "connected-home".equals(data.getHost())) {
            String received = data.getQueryParameter("smartthings");
            if ("connected".equals(received) || "denied".equals(received) ||
                    "error".equals(received) || "invalid_state".equals(received)) {
                outcome = received;
            }
            // Ensure reopening the panel does not replay an old OAuth result.
            intent.setData(null);
        }
        JSObject response = new JSObject();
        response.put("outcome", outcome);
        call.resolve(response);
    }
}
