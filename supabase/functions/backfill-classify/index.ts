import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * BACKFILL-CLASSIFY: Orchestrates the "Deep Backfill" phase after speed-phase onboarding.
 * 
 * Triggered after voice-learning completes (when backfill_status = 'pending').
 * 1. Reads the original email_import_jobs to get the full import_mode target
 * 2. Creates a new import job with the full target (e.g. 30,000)
 * 3. Invokes email-import-v2 (non-speed-phase) which skips already-imported emails via upsert
 * 4. The existing chain (import → classify → voice-learning) handles the rest
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[backfill-classify] Starting for workspace ${workspace_id}`);

    // Check backfill_status
    const { data: progress } = await supabase
      .from('email_import_progress')
      .select('backfill_status')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!progress || progress.backfill_status !== 'pending') {
      console.log(`[backfill-classify] Skipping: backfill_status is '${progress?.backfill_status}', not 'pending'`);
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: `backfill_status is '${progress?.backfill_status}'`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the original (speed phase) import job to read the user's chosen import_mode
    const { data: originalJob } = await supabase
      .from('email_import_jobs')
      .select('import_mode, config_id')
      .eq('workspace_id', workspace_id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Also check the email_provider_configs for the import_mode the user selected
    const { data: emailConfig } = await supabase
      .from('email_provider_configs')
      .select('import_mode')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    // Determine full target based on the user's original choice
    const importMode = emailConfig?.import_mode || originalJob?.import_mode || 'last_30000';
    const fullTarget = importMode === 'all_history' ? 50000 :
                       importMode === 'last_30000' ? 30000 :
                       importMode === 'last_10000' ? 10000 :
                       importMode === 'last_1000' ? 1000 : 30000;

    console.log(`[backfill-classify] Full target: ${fullTarget} (mode: ${importMode})`);

    // Update backfill_status to 'running'
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        backfill_status: 'running',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // Fire email-import-v2 with full target (non-speed-phase)
    // It will use upsert with ignoreDuplicates to skip already-imported emails
    fetch(`${supabaseUrl}/functions/v1/email-import-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        workspace_id,
        import_mode: importMode,
        speed_phase: false, // Full backfill mode
      }),
    }).catch(e => console.error('[backfill-classify] Failed to invoke email-import-v2:', e));

    return new Response(JSON.stringify({
      success: true,
      status: 'backfill_started',
      import_mode: importMode,
      full_target: fullTarget,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[backfill-classify] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
