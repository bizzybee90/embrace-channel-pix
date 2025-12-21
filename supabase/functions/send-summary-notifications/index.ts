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

    console.log('🔔 Checking for scheduled summary notifications...');

    // Get all notification preferences
    const { data: allPrefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('*, workspace:workspaces(id, name, timezone)')
      .eq('summary_enabled', true);

    if (prefsError) throw prefsError;

    if (!allPrefs || allPrefs.length === 0) {
      console.log('No notification preferences configured');
      return new Response(
        JSON.stringify({ success: true, message: 'No preferences configured', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let notificationsSent = 0;

    for (const pref of allPrefs) {
      try {
        // Get current time in the workspace's timezone
        const timezone = pref.timezone || pref.workspace?.timezone || 'Europe/London';
        const now = new Date();
        
        // Convert to timezone-aware time
        const localTime = new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: timezone,
        }).format(now);

        const [currentHour, currentMinute] = localTime.split(':').map(Number);
        const currentMinutes = currentHour * 60 + currentMinute;

        // Check if current time matches any scheduled time (within 15-minute window)
        const scheduledTimes = pref.summary_times || ['08:00', '12:00', '18:00'];
        
        let shouldSend = false;
        for (const timeStr of scheduledTimes) {
          const [hour, minute] = timeStr.split(':').map(Number);
          const scheduledMinutes = hour * 60 + minute;
          
          // Check if we're within 15 minutes of the scheduled time
          // This accounts for cron running every 15 minutes
          if (Math.abs(currentMinutes - scheduledMinutes) <= 7) {
            shouldSend = true;
            console.log(`✅ Time match for workspace ${pref.workspace_id}: ${timeStr} (current: ${localTime})`);
            break;
          }
        }

        if (!shouldSend) {
          console.log(`⏭️ Skipping workspace ${pref.workspace_id}, no time match (current: ${localTime})`);
          continue;
        }

        // Check if we already sent a notification in the last 30 minutes to avoid duplicates
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const { data: recentNotifications } = await supabase
          .from('notifications')
          .select('id')
          .eq('workspace_id', pref.workspace_id)
          .eq('type', 'ai_summary')
          .gte('created_at', thirtyMinsAgo.toISOString())
          .limit(1);

        if (recentNotifications && recentNotifications.length > 0) {
          console.log(`⏭️ Skipping workspace ${pref.workspace_id}, already sent recently`);
          continue;
        }

        // Call ai-inbox-summary to generate and send notifications
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
        
        const response = await fetch(`${supabaseUrl}/functions/v1/ai-inbox-summary`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspace_id: pref.workspace_id,
            send_notifications: true,
          }),
        });

        if (response.ok) {
          notificationsSent++;
          console.log(`✅ Sent notifications for workspace ${pref.workspace_id}`);
        } else {
          const error = await response.text();
          console.error(`❌ Failed for workspace ${pref.workspace_id}:`, error);
        }

      } catch (e) {
        console.error(`Error processing workspace ${pref.workspace_id}:`, e);
      }
    }

    console.log(`🔔 Summary notifications complete. Sent: ${notificationsSent}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        checked: allPrefs.length,
        sent: notificationsSent 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in send-summary-notifications:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
