import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SummaryRequest {
  type: 'morning' | '4hour';
  recipientEmail?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const defaultRecipient = Deno.env.get('SUMMARY_EMAIL_RECIPIENT');

    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resend = new Resend(resendApiKey);
    
    const { type, recipientEmail }: SummaryRequest = await req.json();
    const recipient = recipientEmail || defaultRecipient;

    if (!recipient) {
      throw new Error('No recipient email configured');
    }

    // Determine time range based on summary type
    const now = new Date();
    let startTime: Date;
    let endTime: Date = now;
    let subject: string;

    if (type === 'morning') {
      // Morning digest: 8pm yesterday to 8am today
      startTime = new Date(now);
      startTime.setHours(20, 0, 0, 0);
      startTime.setDate(startTime.getDate() - 1);
      subject = 'Morning Digest - Overnight Activity';
    } else {
      // 4-hour digest
      startTime = new Date(now);
      startTime.setHours(startTime.getHours() - 4);
      subject = '4-Hour Activity Update';
    }

    console.log('Generating summary for:', {
      type,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    });

    // Fetch conversations from the time period
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        id,
        title,
        status,
        is_escalated,
        ai_confidence,
        ai_sentiment,
        ai_reason_for_escalation,
        category,
        created_at,
        customer:customers(name, email, phone)
      `)
      .gte('created_at', startTime.toISOString())
      .lte('created_at', endTime.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching conversations:', error);
      throw error;
    }

    // Calculate stats
    const total = conversations?.length || 0;
    const escalated = conversations?.filter(c => c.is_escalated).length || 0;
    const aiHandled = conversations?.filter(c => !c.is_escalated).length || 0;
    const resolved = conversations?.filter(c => c.status === 'resolved').length || 0;
    const negative = conversations?.filter(c => c.ai_sentiment === 'negative').length || 0;

    // Get escalated conversations needing attention
    const needsAttention = conversations?.filter(
      c => c.is_escalated && c.status !== 'resolved'
    ) || [];

    // Build HTML email
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
    .stat-card { background: white; border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 32px; font-weight: bold; }
    .stat-label { color: #6b7280; font-size: 14px; margin-top: 5px; }
    .green { color: #10b981; }
    .orange { color: #f59e0b; }
    .blue { color: #3b82f6; }
    .red { color: #ef4444; }
    .conversation { background: #f9fafb; padding: 15px; border-left: 3px solid #3b82f6; margin: 10px 0; border-radius: 4px; }
    .escalated { border-left-color: #f59e0b; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; }
    .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BizzyBee ${subject}</h1>
      <p>Summary for ${startTime.toLocaleString()} - ${endTime.toLocaleString()}</p>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Conversations</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">${aiHandled}</div>
        <div class="stat-label">AI Handled</div>
      </div>
      <div class="stat-card">
        <div class="stat-value orange">${escalated}</div>
        <div class="stat-label">Escalated</div>
      </div>
      <div class="stat-card">
        <div class="stat-value blue">${resolved}</div>
        <div class="stat-label">Resolved</div>
      </div>
    </div>

    ${negative > 0 ? `
      <div class="conversation escalated">
        <strong>⚠️ ${negative} conversation(s) with negative sentiment</strong>
        <p>These customers may need extra attention</p>
      </div>
    ` : ''}

    ${needsAttention.length > 0 ? `
      <h2>Conversations Needing Attention (${needsAttention.length})</h2>
      ${needsAttention.slice(0, 5).map(conv => `
        <div class="conversation escalated">
          <strong>${conv.title}</strong>
          <p><strong>Reason:</strong> ${conv.ai_reason_for_escalation || 'Not specified'}</p>
          <p><strong>Category:</strong> ${conv.category || 'Other'}</p>
          <p><strong>Confidence:</strong> ${conv.ai_confidence ? Math.round(conv.ai_confidence) + '%' : 'N/A'}</p>
          <p><strong>Sentiment:</strong> ${conv.ai_sentiment || 'Unknown'}</p>
        </div>
      `).join('')}
      
      ${needsAttention.length > 5 ? `
        <p><em>...and ${needsAttention.length - 5} more</em></p>
      ` : ''}
    ` : `
      <div class="conversation">
        <strong>✅ All clear!</strong>
        <p>No conversations needing immediate attention</p>
      </div>
    `}

    ${total === 0 ? `
      <div class="conversation">
        <p>No new conversations during this period.</p>
      </div>
    ` : ''}

    <a href="${supabaseUrl.replace('supabase.co', 'lovable.app')}/escalations" class="button">
      View Escalations Dashboard
    </a>

    <div class="footer">
      <p>This is an automated summary from BizzyBee AI</p>
      <p>To adjust your email preferences, contact your administrator</p>
    </div>
  </div>
</body>
</html>
    `;

    // Send email
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'BizzyBee <onboarding@resend.dev>',
      to: [recipient],
      subject: `BizzyBee - ${subject}`,
      html
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      throw emailError;
    }

    console.log('Summary email sent successfully:', emailData);

    return new Response(
      JSON.stringify({
        success: true,
        emailId: emailData?.id,
        stats: {
          total,
          aiHandled,
          escalated,
          resolved,
          negative
        },
        period: {
          start: startTime.toISOString(),
          end: endTime.toISOString()
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in send-scheduled-summary:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
