import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { workspace_id, send_notifications = false } = await req.json();
    console.log('📊 Generating AI inbox summary for workspace:', workspace_id);

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    // Get conversations from the last 24 hours
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id, title, category, status, decision_bucket, requires_reply,
        ai_draft_response, summary_for_human, created_at, channel,
        customer:customers(name, email)
      `)
      .eq('workspace_id', workspace_id)
      .gte('created_at', yesterday.toISOString())
      .order('created_at', { ascending: false })
      .limit(20);

    if (convError) throw convError;

    if (!conversations || conversations.length === 0) {
      const summary = "No new emails in the last 24 hours. Inbox is clear! 🎉";
      return new Response(
        JSON.stringify({ success: true, summary, conversations: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare conversation data for AI
    const conversationSummaries = conversations.map(c => {
      const customer = Array.isArray(c.customer) ? c.customer[0] : c.customer;
      return {
        title: c.title || 'Untitled',
        from: customer?.name || customer?.email || 'Unknown',
        category: c.category,
      status: c.status,
      decision_bucket: c.decision_bucket,
      requires_reply: c.requires_reply,
      has_draft: !!c.ai_draft_response,
        summary: c.summary_for_human,
        channel: c.channel,
      };
    });

    // Call Lovable AI to generate natural language summary
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are BizzyBee, a friendly AI assistant helping summarize emails. Generate a brief, conversational summary of recent emails as if you're a personal assistant briefing your boss. Be warm but professional. Keep it to 2-4 sentences max.

Guidelines:
- Mention what was auto-handled and why (e.g., "automated receipts", "job alerts")
- Highlight any drafts ready for review
- Flag anything that needs their direct attention
- Use the sender's first name when possible
- Be specific about the nature of emails
- Add a light emoji where appropriate`
          },
          {
            role: 'user',
            content: `Here are the recent emails to summarize:\n\n${JSON.stringify(conversationSummaries, null, 2)}`
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const summary = aiData.choices?.[0]?.message?.content || 'Unable to generate summary';

    console.log('✅ Summary generated:', summary);

    // If send_notifications is true, send to configured channels
    if (send_notifications) {
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('workspace_id', workspace_id)
        .single();

      if (prefs && prefs.summary_enabled) {
        const channels = prefs.summary_channels || ['in_app'];

        // Send in-app notification
        if (channels.includes('in_app')) {
          await supabase.from('notifications').insert({
            workspace_id,
            type: 'ai_summary',
            title: '📬 Your Email Briefing',
            body: summary,
            metadata: { conversation_count: conversations.length }
          });
          console.log('✅ In-app notification sent');
        }

        // Send email notification
        if (channels.includes('email') && prefs.summary_email) {
          const POSTMARK_API_KEY = Deno.env.get('POSTMARK_API_KEY');
          if (POSTMARK_API_KEY) {
            try {
              await fetch('https://api.postmarkapp.com/email', {
                method: 'POST',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'X-Postmark-Server-Token': POSTMARK_API_KEY,
                },
                body: JSON.stringify({
                  From: 'noreply@yourdomain.com',
                  To: prefs.summary_email,
                  Subject: '📬 Your BizzyBee Email Briefing',
                  TextBody: summary,
                  HtmlBody: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                      <h2 style="color: #F59E0B;">🐝 BizzyBee Email Briefing</h2>
                      <p style="font-size: 16px; line-height: 1.6;">${summary.replace(/\n/g, '<br>')}</p>
                      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                      <p style="color: #666; font-size: 14px;">Open the app to view details and respond.</p>
                    </div>
                  `,
                }),
              });
              console.log('✅ Email notification sent to', prefs.summary_email);
            } catch (e) {
              console.error('Failed to send email:', e);
            }
          }
        }

        // Send SMS notification
        if (channels.includes('sms') && prefs.summary_phone) {
          const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
          const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
          const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
            try {
              // Shorten for SMS
              const smsBody = summary.length > 140 
                ? summary.substring(0, 137) + '...' 
                : summary;

              const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
              const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

              await fetch(twilioUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${auth}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  To: prefs.summary_phone,
                  From: TWILIO_PHONE_NUMBER,
                  Body: `📬 BizzyBee: ${smsBody}`,
                }),
              });
              console.log('✅ SMS notification sent to', prefs.summary_phone);
            } catch (e) {
              console.error('Failed to send SMS:', e);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        summary,
        conversation_count: conversations.length,
        conversations: conversationSummaries 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error generating AI summary:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
