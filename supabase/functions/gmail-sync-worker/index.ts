import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50;
const MAX_RUNTIME_MS = 55000; // 55 seconds to stay under 60s limit

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiresAt: string } | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      console.error("Token refresh failed:", await response.text());
      return null;
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    return { accessToken: data.access_token, expiresAt };
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { configId } = await req.json();

    if (!configId) {
      return new Response(JSON.stringify({ error: "Missing configId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load config
    const { data: config, error: configError } = await supabase
      .from("email_provider_configs")
      .select("*")
      .eq("id", configId)
      .single();

    if (configError || !config) {
      console.error("Config not found:", configError);
      return new Response(JSON.stringify({ error: "Config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = config.access_token;
    const refreshToken = config.refresh_token;

    // Check if token needs refresh
    if (config.token_expires_at) {
      const expiresAt = new Date(config.token_expires_at);
      const now = new Date();
      const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

      if (now.getTime() > expiresAt.getTime() - bufferMs) {
        console.log("Token expired or expiring soon, refreshing...");
        const refreshed = await refreshAccessToken(refreshToken, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        if (refreshed) {
          accessToken = refreshed.accessToken;
          await supabase
            .from("email_provider_configs")
            .update({
              access_token: refreshed.accessToken,
              token_expires_at: refreshed.expiresAt,
            })
            .eq("id", configId);
          console.log("Token refreshed successfully");
        } else {
          console.error("Failed to refresh token");
          await supabase
            .from("email_provider_configs")
            .update({ sync_status: "error", sync_error: "Failed to refresh access token" })
            .eq("id", configId);
          return new Response(JSON.stringify({ error: "Token refresh failed" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Determine current phase based on sync_stage
    const currentStage = config.sync_stage || "fetching_inbox";
    const inboundProcessed = config.inbound_emails_found || 0;
    const outboundProcessed = config.outbound_emails_found || 0;
    const inboundTotal = config.inbound_total || 0;
    const outboundTotal = config.outbound_total || 0;
    const syncTotal = config.sync_total || inboundTotal + outboundTotal;

    // Update status to syncing
    await supabase
      .from("email_provider_configs")
      .update({
        sync_status: "syncing",
        sync_started_at: config.sync_started_at || new Date().toISOString(),
      })
      .eq("id", configId);

    let processed = 0;
    let pageToken: string | undefined;
    let needsContinuation = false;

    // Process INBOX phase
    if (currentStage === "fetching_inbox" || currentStage === "pending") {
      console.log(`Processing INBOX - already processed: ${inboundProcessed}/${inboundTotal}`);

      await supabase
        .from("email_provider_configs")
        .update({ sync_stage: "fetching_inbox" })
        .eq("id", configId);

      // Fetch messages from inbox
      let inboxProcessedThisBatch = 0;

      while (Date.now() - startTime < MAX_RUNTIME_MS) {
        const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        listUrl.searchParams.set("labelIds", "INBOX");
        listUrl.searchParams.set("maxResults", String(BATCH_SIZE));
        if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

        const listResponse = await fetch(listUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!listResponse.ok) {
          console.error("Failed to list messages:", await listResponse.text());
          break;
        }

        const listData = await listResponse.json();
        const messages = listData.messages || [];
        pageToken = listData.nextPageToken;

        if (messages.length === 0) {
          console.log("No more inbox messages");
          break;
        }

        // Process each message
        for (const msg of messages) {
          if (Date.now() - startTime >= MAX_RUNTIME_MS) {
            needsContinuation = true;
            break;
          }

          // Fetch full message
          const msgResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (!msgResponse.ok) {
            console.error(`Failed to fetch message ${msg.id}`);
            continue;
          }

          const fullMsg = await msgResponse.json();
          const headers = fullMsg.payload?.headers || [];

          const getHeader = (name: string) =>
            headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

          const from = getHeader("From");
          const to = getHeader("To");
          const subject = getHeader("Subject");
          const date = getHeader("Date");

          // Extract body
          let body = "";
          const payload = fullMsg.payload;
          if (payload) {
            if (payload.body?.data) {
              body = atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
            } else if (payload.parts) {
              for (const part of payload.parts) {
                if (part.mimeType === "text/plain" && part.body?.data) {
                  body = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
                  break;
                } else if (part.mimeType === "text/html" && part.body?.data) {
                  const htmlBody = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
                  body = stripHtml(htmlBody);
                }
              }
            }
          }

          // Extract sender email
          const emailMatch = from.match(/<([^>]+)>/) || [null, from];
          const senderEmail = emailMatch[1]?.toLowerCase() || from.toLowerCase();
          const senderName = from.replace(/<[^>]+>/, "").trim() || senderEmail;

          // Skip if from our own email (it's not a customer email)
          const ownEmails = [config.email_address.toLowerCase(), ...(config.aliases || []).map((a: string) => a.toLowerCase())];
          if (ownEmails.some(e => senderEmail.includes(e))) {
            inboxProcessedThisBatch++;
            continue;
          }

          // Check for existing message
          const { data: existingMsg } = await supabase
            .from("messages")
            .select("id")
            .eq("raw_payload->gmail_id", msg.id)
            .single();

          if (existingMsg) {
            inboxProcessedThisBatch++;
            continue;
          }

          // Find or create customer
          let customerId: string;
          const { data: existingCustomer } = await supabase
            .from("customers")
            .select("id")
            .eq("workspace_id", config.workspace_id)
            .eq("email", senderEmail)
            .single();

          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else {
            const { data: newCustomer, error: customerError } = await supabase
              .from("customers")
              .insert({
                workspace_id: config.workspace_id,
                email: senderEmail,
                name: senderName,
              })
              .select("id")
              .single();

            if (customerError || !newCustomer) {
              console.error("Failed to create customer:", customerError);
              continue;
            }
            customerId = newCustomer.id;
          }

          // Create conversation
          const { data: conversation, error: convError } = await supabase
            .from("conversations")
            .insert({
              workspace_id: config.workspace_id,
              customer_id: customerId,
              channel: "email",
              status: "open",
              title: subject || "No Subject",
              external_conversation_id: fullMsg.threadId,
              created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
            })
            .select("id")
            .single();

          if (convError || !conversation) {
            console.error("Failed to create conversation:", convError);
            continue;
          }

          // Create message
          await supabase.from("messages").insert({
            conversation_id: conversation.id,
            direction: "inbound",
            channel: "email",
            actor_type: "customer",
            actor_name: senderName,
            body: body.substring(0, 10000), // Limit body size
            created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
            raw_payload: { gmail_id: msg.id, thread_id: fullMsg.threadId },
          });

          inboxProcessedThisBatch++;
          processed++;
        }

        if (needsContinuation || !pageToken) break;
      }

      // Update progress
      const newInboundProcessed = inboundProcessed + inboxProcessedThisBatch;
      const totalProcessed = newInboundProcessed + outboundProcessed;
      const progressPercent = syncTotal > 0 ? Math.round((totalProcessed / syncTotal) * 100) : 0;

      await supabase
        .from("email_provider_configs")
        .update({
          inbound_emails_found: newInboundProcessed,
          sync_progress: progressPercent,
        })
        .eq("id", configId);

      console.log(`Inbox progress: ${newInboundProcessed}/${inboundTotal} (${progressPercent}%)`);

      // Check if inbox is done
      if (!pageToken && !needsContinuation) {
        console.log("Inbox phase complete, moving to sent...");
        await supabase
          .from("email_provider_configs")
          .update({ sync_stage: "fetching_sent" })
          .eq("id", configId);

        // Continue to sent phase in same request if time allows
        if (Date.now() - startTime < MAX_RUNTIME_MS - 10000) {
          needsContinuation = true; // Will trigger continuation for sent phase
        }
      } else if (needsContinuation || pageToken) {
        // Need to continue inbox
        supabase.functions
          .invoke("gmail-sync-worker", { body: { configId } })
          .catch((err) => console.error("Failed to continue sync:", err));

        return new Response(
          JSON.stringify({
            success: true,
            phase: "inbox",
            processed: inboxProcessedThisBatch,
            progress: progressPercent,
            continuing: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Process SENT phase
    if (config.sync_stage === "fetching_sent" || (currentStage === "fetching_inbox" && !pageToken)) {
      console.log(`Processing SENT - already processed: ${outboundProcessed}/${outboundTotal}`);

      await supabase
        .from("email_provider_configs")
        .update({ sync_stage: "fetching_sent" })
        .eq("id", configId);

      let sentProcessedThisBatch = 0;
      pageToken = undefined;

      while (Date.now() - startTime < MAX_RUNTIME_MS) {
        const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        listUrl.searchParams.set("labelIds", "SENT");
        listUrl.searchParams.set("maxResults", String(BATCH_SIZE));
        if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

        const listResponse = await fetch(listUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!listResponse.ok) {
          console.error("Failed to list sent messages:", await listResponse.text());
          break;
        }

        const listData = await listResponse.json();
        const messages = listData.messages || [];
        pageToken = listData.nextPageToken;

        if (messages.length === 0) {
          console.log("No more sent messages");
          break;
        }

        for (const msg of messages) {
          if (Date.now() - startTime >= MAX_RUNTIME_MS) {
            needsContinuation = true;
            break;
          }

          // Fetch full message
          const msgResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (!msgResponse.ok) continue;

          const fullMsg = await msgResponse.json();
          const headers = fullMsg.payload?.headers || [];

          const getHeader = (name: string) =>
            headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

          const to = getHeader("To");
          const subject = getHeader("Subject");
          const date = getHeader("Date");

          // Extract body
          let body = "";
          const payload = fullMsg.payload;
          if (payload) {
            if (payload.body?.data) {
              body = atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
            } else if (payload.parts) {
              for (const part of payload.parts) {
                if (part.mimeType === "text/plain" && part.body?.data) {
                  body = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
                  break;
                } else if (part.mimeType === "text/html" && part.body?.data) {
                  const htmlBody = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
                  body = stripHtml(htmlBody);
                }
              }
            }
          }

          // Check if message already exists
          const { data: existingMsg } = await supabase
            .from("messages")
            .select("id")
            .eq("raw_payload->gmail_id", msg.id)
            .single();

          if (existingMsg) {
            sentProcessedThisBatch++;
            continue;
          }

          // Find conversation by thread ID
          const { data: existingConv } = await supabase
            .from("conversations")
            .select("id")
            .eq("workspace_id", config.workspace_id)
            .eq("external_conversation_id", fullMsg.threadId)
            .single();

          if (existingConv) {
            // Add outbound message to existing conversation
            await supabase.from("messages").insert({
              conversation_id: existingConv.id,
              direction: "outbound",
              channel: "email",
              actor_type: "agent",
              actor_name: config.email_address,
              body: body.substring(0, 10000),
              created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
              raw_payload: { gmail_id: msg.id, thread_id: fullMsg.threadId },
            });
          }

          sentProcessedThisBatch++;
          processed++;
        }

        if (needsContinuation || !pageToken) break;
      }

      // Update progress
      const newOutboundProcessed = outboundProcessed + sentProcessedThisBatch;
      const newInboundProcessed = config.inbound_emails_found || inboundProcessed;
      const totalProcessed = newInboundProcessed + newOutboundProcessed;
      const progressPercent = syncTotal > 0 ? Math.round((totalProcessed / syncTotal) * 100) : 0;

      await supabase
        .from("email_provider_configs")
        .update({
          outbound_emails_found: newOutboundProcessed,
          sync_progress: progressPercent,
        })
        .eq("id", configId);

      console.log(`Sent progress: ${newOutboundProcessed}/${outboundTotal} (${progressPercent}%)`);

      // Check if complete
      if (!pageToken && !needsContinuation) {
        console.log("Sync complete!");
        await supabase
          .from("email_provider_configs")
          .update({
            sync_status: "completed",
            sync_stage: "completed",
            sync_progress: 100,
            sync_completed_at: new Date().toISOString(),
          })
          .eq("id", configId);

        // Trigger thread matching
        supabase.functions
          .invoke("match-email-threads", { body: { workspaceId: config.workspace_id } })
          .catch((err) => console.error("Failed to start thread matching:", err));

        return new Response(
          JSON.stringify({
            success: true,
            phase: "completed",
            processed,
            progress: 100,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // Continue sent phase
        supabase.functions
          .invoke("gmail-sync-worker", { body: { configId } })
          .catch((err) => console.error("Failed to continue sync:", err));

        return new Response(
          JSON.stringify({
            success: true,
            phase: "sent",
            processed: sentProcessedThisBatch,
            progress: progressPercent,
            continuing: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, progress: config.sync_progress }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("gmail-sync-worker error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
