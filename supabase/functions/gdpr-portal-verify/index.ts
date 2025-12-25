import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const postmarkApiKey = Deno.env.get('POSTMARK_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { token, action } = await req.json();

    if (!token || !action) {
      return new Response(
        JSON.stringify({ error: 'Token and action are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the token
    const [tokenId, encodedData] = token.split('_');
    if (!tokenId || !encodedData) {
      return new Response(
        JSON.stringify({ error: 'Invalid token format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode request data
    let requestData;
    try {
      requestData = JSON.parse(atob(encodedData));
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid token data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (new Date(requestData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Token has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify action matches
    if (requestData.request_type !== action) {
      return new Response(
        JSON.stringify({ error: 'Action mismatch' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Verified GDPR request:', { email: requestData.email, action });

    // Find customer by email
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, email, phone, workspace_id')
      .eq('email', requestData.email)
      .maybeSingle();

    if (action === 'export') {
      // Process data export
      if (customer) {
        // Invoke the existing export function
        const { data: exportData, error: exportError } = await supabase.functions.invoke('export-customer-data', {
          body: {
            customer_identifier: requestData.email,
            delivery_method: 'email'
          }
        });

        if (exportError) {
          console.error('Export error:', exportError);
          throw new Error('Failed to generate export');
        }

        // Send export via email
        if (postmarkApiKey && exportData?.data) {
          const exportJson = JSON.stringify(exportData.data, null, 2);
          
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: requestData.email,
              Subject: 'Your Data Export',
              HtmlBody: `
                <h2>Your Data Export</h2>
                <p>Hello${customer.name ? ` ${customer.name}` : ''},</p>
                <p>As requested, here is a copy of all your personal data we have on file.</p>
                <p>Your data is attached as a JSON file for portability.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
                <h3>Your Rights</h3>
                <ul>
                  <li><strong>Right to Access:</strong> You can request your data at any time</li>
                  <li><strong>Right to Erasure:</strong> You can request deletion of your data</li>
                  <li><strong>Right to Rectification:</strong> You can request corrections to your data</li>
                  <li><strong>Right to Portability:</strong> This export is in JSON format for portability</li>
                </ul>
              `,
              Attachments: [{
                Name: 'my-data-export.json',
                Content: btoa(exportJson),
                ContentType: 'application/json'
              }],
              MessageStream: 'outbound'
            })
          });
        }

        // Log the completed export
        await supabase.from('data_access_logs').insert({
          action: 'gdpr_export_completed',
          customer_id: customer.id,
          metadata: {
            email: requestData.email,
            export_size: JSON.stringify(exportData?.data || {}).length
          }
        });
      } else {
        // No customer found - send email saying no data
        if (postmarkApiKey) {
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: requestData.email,
              Subject: 'Your Data Export Request',
              HtmlBody: `
                <h2>Data Export Request</h2>
                <p>We received your data export request for this email address.</p>
                <p>After searching our records, we did not find any personal data associated with this email address.</p>
                <p>If you believe this is an error, please contact us.</p>
              `,
              MessageStream: 'outbound'
            })
          });
        }
      }
    } else if (action === 'deletion') {
      // Process deletion request
      if (customer) {
        // Create deletion request
        const { error: insertError } = await supabase
          .from('data_deletion_requests')
          .insert({
            customer_id: customer.id,
            reason: requestData.reason || 'Customer portal request',
            deletion_type: 'full',
            status: 'pending'
          });

        if (insertError) {
          console.error('Error creating deletion request:', insertError);
          throw new Error('Failed to create deletion request');
        }

        // Send confirmation email
        if (postmarkApiKey) {
          const estimatedDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: requestData.email,
              Subject: 'Data Deletion Request Confirmed',
              HtmlBody: `
                <h2>Data Deletion Request Confirmed</h2>
                <p>Hello${customer.name ? ` ${customer.name}` : ''},</p>
                <p>Your request to delete your personal data has been confirmed and queued for processing.</p>
                <p><strong>Estimated completion:</strong> ${estimatedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p>Under GDPR, we have 30 days to complete your request. You will receive a confirmation email once the deletion is complete.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
                <p style="color: #6b7280; font-size: 12px;">
                  If you did not make this request, please contact us immediately.
                </p>
              `,
              MessageStream: 'outbound'
            })
          });
        }

        // Log the deletion request
        await supabase.from('data_access_logs').insert({
          action: 'gdpr_deletion_requested',
          customer_id: customer.id,
          metadata: {
            email: requestData.email,
            reason: requestData.reason
          }
        });
      } else {
        // No customer found
        if (postmarkApiKey) {
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-Postmark-Server-Token': postmarkApiKey
            },
            body: JSON.stringify({
              From: 'noreply@bizzybee.ai',
              To: requestData.email,
              Subject: 'Data Deletion Request',
              HtmlBody: `
                <h2>Data Deletion Request</h2>
                <p>We received your data deletion request for this email address.</p>
                <p>After searching our records, we did not find any personal data associated with this email address.</p>
                <p>No further action is required on your part.</p>
              `,
              MessageStream: 'outbound'
            })
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        customer_found: !!customer
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error verifying GDPR request:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
