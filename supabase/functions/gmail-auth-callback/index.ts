import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function redirectTo(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

function buildRedirectUrl(origin: string, status: string, message?: string, errorCode?: string, errorDescription?: string): string {
  const url = new URL("/onboarding", origin);
  url.searchParams.set("email_status", status);
  if (message) url.searchParams.set("message", message);
  if (errorCode) url.searchParams.set("error_code", errorCode);
  if (errorDescription) url.searchParams.set("error_description", errorDescription);
  return url.toString();
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const defaultOrigin = "https://lovable.dev";
  let origin = defaultOrigin;
  let workspaceId = "";
  let importMode = "last_1000";

  // Decode state
  if (stateParam) {
    try {
      const state = JSON.parse(atob(stateParam));
      origin = state.origin || defaultOrigin;
      workspaceId = state.workspaceId;
      importMode = state.importMode || "last_1000";
    } catch (e) {
      console.error("Failed to decode state:", e);
    }
  }

  // Handle OAuth errors - capture all error details from Google
  const errorDescription = url.searchParams.get("error_description");
  if (error) {
    console.error("OAuth error:", error, "Description:", errorDescription);
    return redirectTo(
      buildRedirectUrl(origin, "error", `Google OAuth error: ${error}`, error, errorDescription || undefined)
    );
  }

  if (!code || !workspaceId) {
    return redirectTo(buildRedirectUrl(origin, "error", "Missing authorization code or workspace"));
  }

  try {
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callbackUrl = `${SUPABASE_URL}/functions/v1/gmail-auth-callback`;

    // Exchange code for tokens
    console.log("Exchanging code for tokens...");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return redirectTo(buildRedirectUrl(origin, "error", "Failed to exchange authorization code"));
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log("Got tokens, fetching user email...");

    // Get user's email address
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoResponse.ok) {
      console.error("Failed to get user info");
      return redirectTo(buildRedirectUrl(origin, "error", "Failed to get user email"));
    }

    const userInfo = await userInfoResponse.json();
    const emailAddress = userInfo.email;

    console.log("User email:", emailAddress);

    // Get inbox total count - THIS IS THE KEY FEATURE
    console.log("Fetching inbox total count...");
    const inboxLabelResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let inboxTotal = 0;
    if (inboxLabelResponse.ok) {
      const inboxLabel = await inboxLabelResponse.json();
      inboxTotal = inboxLabel.messagesTotal || 0;
      console.log("Inbox total:", inboxTotal);
    } else {
      console.error("Failed to get inbox label:", await inboxLabelResponse.text());
    }

    // Get sent total count
    console.log("Fetching sent total count...");
    const sentLabelResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/SENT",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let sentTotal = 0;
    if (sentLabelResponse.ok) {
      const sentLabel = await sentLabelResponse.json();
      sentTotal = sentLabel.messagesTotal || 0;
      console.log("Sent total:", sentTotal);
    } else {
      console.error("Failed to get sent label:", await sentLabelResponse.text());
    }

    const syncTotal = inboxTotal + sentTotal;
    console.log("Total emails to sync:", syncTotal);

    // Store in database
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check for existing config
    const { data: existingConfig } = await supabase
      .from("email_provider_configs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("email_address", emailAddress)
      .single();

    const configData = {
      workspace_id: workspaceId,
      provider: "gmail",
      account_id: userInfo.id || emailAddress,
      email_address: emailAddress,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: tokenExpiresAt,
      import_mode: importMode,
      connected_at: new Date().toISOString(),
      sync_status: "pending",
      sync_stage: "pending",
      sync_progress: 0,
      inbound_total: inboxTotal,
      outbound_total: sentTotal,
      sync_total: syncTotal,
      inbound_emails_found: 0,
      outbound_emails_found: 0,
    };

    let configId: string;

    if (existingConfig) {
      // Update existing
      const { error: updateError } = await supabase
        .from("email_provider_configs")
        .update(configData)
        .eq("id", existingConfig.id);

      if (updateError) {
        console.error("Failed to update config:", updateError);
        return redirectTo(buildRedirectUrl(origin, "error", "Failed to save configuration"));
      }
      configId = existingConfig.id;
    } else {
      // Insert new
      const { data: newConfig, error: insertError } = await supabase
        .from("email_provider_configs")
        .insert(configData)
        .select("id")
        .single();

      if (insertError || !newConfig) {
        console.error("Failed to insert config:", insertError);
        return redirectTo(buildRedirectUrl(origin, "error", "Failed to save configuration"));
      }
      configId = newConfig.id;
    }

    console.log("Saved config:", configId);

    // Trigger sync worker
    console.log("Triggering gmail-sync-worker...");
    supabase.functions
      .invoke("gmail-sync-worker", {
        body: { configId },
      })
      .catch((err) => console.error("Failed to start gmail-sync-worker:", err));

    // Redirect to success
    return redirectTo(buildRedirectUrl(origin, "success"));
  } catch (error) {
    console.error("gmail-auth-callback error:", error);
    return redirectTo(buildRedirectUrl(origin, "error", String(error)));
  }
});
