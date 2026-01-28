import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

interface ClassificationResult {
  id: string
  category: string
  requires_reply: boolean
  urgency: string
  confidence: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const { workspace_id } = await req.json()
    
    if (!workspace_id) {
      throw new Error('workspace_id is required')
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    console.log('[classify-emails] Starting for workspace:', workspace_id)

    // =========================================
    // STEP 1: Fetch locked batch of 50 emails
    // =========================================
    
    const { data: emails, error: fetchError } = await supabase
      .rpc('get_unprocessed_batch', { 
        p_workspace_id: workspace_id, 
        p_batch_size: 50 
      })
    
    if (fetchError) {
      throw new Error(`Fetch error: ${fetchError.message}`)
    }
    
    if (!emails || emails.length === 0) {
      console.log('[classify-emails] Queue empty')
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Queue empty',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[classify-emails] Fetched ${emails.length} emails`)

    // =========================================
    // STEP 2: Fetch known sender patterns
    // =========================================
    
    const { data: knownSenders } = await supabase
      .from('known_senders')
      .select('*')
      .or(`is_global.eq.true,workspace_id.eq.${workspace_id}`)

    // =========================================
    // STEP 3: Fetch business context
    // =========================================
    
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('business_name, industry, services')
      .eq('workspace_id', workspace_id)
      .single()

    // =========================================
    // STEP 4: Fetch recent corrections (for learning)
    // =========================================
    
    const { data: corrections } = await supabase
      .from('classification_corrections')
      .select('original_text, corrected_category, corrected_requires_reply')
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: false })
      .limit(5)

    // =========================================
    // STEP 5: STAGE 1 - Rule Gate (instant, free)
    // =========================================
    
    const rulesResults: any[] = []
    const aiBatch: any[] = []
    
    for (const email of emails) {
      let matched = false
      const sender = email.from_email?.toLowerCase() || ''
      const subject = email.subject?.toLowerCase() || ''
      
      // Check against known sender patterns
      for (const pattern of (knownSenders || [])) {
        let isMatch = false
        
        if (pattern.pattern_type === 'contains') {
          isMatch = sender.includes(pattern.pattern.toLowerCase())
        } else if (pattern.pattern_type === 'ends_with') {
          isMatch = sender.endsWith(pattern.pattern.toLowerCase())
        } else if (pattern.pattern_type === 'equals') {
          isMatch = sender === pattern.pattern.toLowerCase()
        }
        
        if (isMatch) {
          rulesResults.push({
            id: email.id,
            category: pattern.category,
            requires_reply: pattern.requires_reply,
            urgency: 'low',
            confidence: 1.0,
            classified_by: 'rules',
            classified_at: new Date().toISOString(),
            status: 'classified'
          })
          matched = true
          break
        }
      }
      
      // Additional subject-based rules
      if (!matched) {
        // Payment confirmations
        if (subject.includes('payment received') || 
            subject.includes('payment confirmation') ||
            subject.includes('receipt for') ||
            subject.includes('invoice paid') ||
            subject.includes('your receipt') ||
            subject.includes('order confirmation')) {
          rulesResults.push({
            id: email.id,
            category: 'payment_billing',
            requires_reply: false,
            urgency: 'low',
            confidence: 0.95,
            classified_by: 'rules',
            classified_at: new Date().toISOString(),
            status: 'classified'
          })
          matched = true
        }
        // Newsletters
        else if (subject.includes('unsubscribe') ||
                 subject.includes('newsletter') ||
                 subject.includes('weekly digest') ||
                 subject.includes('daily digest') ||
                 subject.includes('your weekly') ||
                 subject.includes('your monthly')) {
          rulesResults.push({
            id: email.id,
            category: 'newsletter',
            requires_reply: false,
            urgency: 'low',
            confidence: 0.95,
            classified_by: 'rules',
            classified_at: new Date().toISOString(),
            status: 'classified'
          })
          matched = true
        }
        // Auto-replies
        else if (subject.includes('out of office') ||
                 subject.includes('automatic reply') ||
                 subject.includes('auto-reply') ||
                 subject.includes('away from') ||
                 subject.startsWith('re: re: re:')) {
          rulesResults.push({
            id: email.id,
            category: 'notification',
            requires_reply: false,
            urgency: 'low',
            confidence: 0.95,
            classified_by: 'rules',
            classified_at: new Date().toISOString(),
            status: 'classified'
          })
          matched = true
        }
      }
      
      // If no rule matched, send to AI
      if (!matched) {
        aiBatch.push({
          id: email.id,
          subject: email.subject || '',
          body: (email.body_text || '').substring(0, 300),
          sender: email.from_email || '',
          folder: email.folder || 'INBOX'
        })
      }
    }

    console.log(`[classify-emails] Rules classified: ${rulesResults.length}, AI batch: ${aiBatch.length}`)

    // =========================================
    // STEP 6: STAGE 2 - AI Batch Processing
    // =========================================
    
    const aiResults: any[] = []
    
    if (aiBatch.length > 0) {
      // Build few-shot examples from corrections
      let fewShotExamples = ''
      if (corrections && corrections.length > 0) {
        fewShotExamples = '\n\nLEARNED CORRECTIONS (Apply these patterns):\n' +
          corrections.map((c, i) => 
            `${i + 1}. "${c.original_text?.substring(0, 100)}" → category: ${c.corrected_category}, requires_reply: ${c.corrected_requires_reply}`
          ).join('\n')
      }
      
      // Process in chunks of 15 for efficiency
      const chunkSize = 15
      
      for (let i = 0; i < aiBatch.length; i += chunkSize) {
        const chunk = aiBatch.slice(i, i + chunkSize)
        
        const systemPrompt = `You are an email classifier for a ${businessProfile?.industry || 'service business'} called "${businessProfile?.business_name || 'the business'}".

SERVICES OFFERED: ${JSON.stringify(businessProfile?.services || ['Various services'])}

CLASSIFICATION CATEGORIES:
- "quote_request": Asking for price, cost, quote, availability. Set urgency: "high", requires_reply: true
- "booking_request": Confirming appointment, scheduling, asking to book. Set urgency: "high", requires_reply: true
- "complaint": Unhappy customer, issue, problem, missed service. Set urgency: "high", requires_reply: true
- "payment_billing": Invoices, receipts, payment confirmations. Set requires_reply: false unless there's a question
- "general_inquiry": General questions, information requests. Set requires_reply: true
- "job_application": Someone asking about jobs/work. NOT a customer lead. Set requires_reply: true
- "notification": Automated alerts, confirmations with no action needed. Set requires_reply: false
- "newsletter": Marketing, promotions, newsletters. Set requires_reply: false
- "spam": Irrelevant, scam, phishing. Set requires_reply: false

IMPORTANT RULES:
1. If email is from SENT folder, it's an OUTBOUND email - classify based on what it's responding to
2. If email is just "Thanks" or "OK" with no question, set requires_reply: false
3. If email is a receipt/confirmation with no question mark, set requires_reply: false
4. If email contains a clear question (has "?"), set requires_reply: true
5. Set confidence < 0.7 if you're unsure
${fewShotExamples}

For each email, return a JSON object with: id, category, requires_reply (boolean), urgency ("low"/"medium"/"high"), confidence (0-1).

Return your response as a JSON array of results.`

        const emailsJson = JSON.stringify(chunk.map(e => ({
          id: e.id,
          subject: e.subject,
          body: e.body,
          sender: e.sender,
          folder: e.folder
        })))

        try {
          const claudeResponse = await fetch(ANTHROPIC_API, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 2000,
              messages: [
                { role: 'user', content: `${systemPrompt}\n\nEMAILS TO CLASSIFY:\n${emailsJson}\n\nReturn ONLY a JSON array of results, nothing else.` }
              ]
            })
          })

          if (!claudeResponse.ok) {
            throw new Error(`Claude API error: ${claudeResponse.status}`)
          }

          const claudeData = await claudeResponse.json()
          const responseText = claudeData.content?.[0]?.text || '[]'
          
          // Parse JSON (handle markdown code blocks)
          let parsed: ClassificationResult[]
          try {
            const cleanJson = responseText
              .replace(/```json\s*/g, '')
              .replace(/```\s*/g, '')
              .trim()
            parsed = JSON.parse(cleanJson)
          } catch {
            console.error('[classify-emails] Failed to parse response:', responseText.slice(0, 200))
            parsed = []
          }
          
          for (const result of parsed) {
            const originalEmail = chunk.find(e => e.id === result.id)
            
            // Post-processing overrides
            let finalRequiresReply = result.requires_reply
            
            // Force requires_reply: false for payment emails without questions
            if (result.category === 'payment_billing' && 
                !originalEmail?.body?.includes('?')) {
              finalRequiresReply = false
            }
            
            // Force requires_reply: false for confirmations without questions
            if ((originalEmail?.subject?.toLowerCase().includes('confirmed') ||
                originalEmail?.subject?.toLowerCase().includes('confirmation')) &&
                !originalEmail?.body?.includes('?')) {
              finalRequiresReply = false
            }
            
            aiResults.push({
              id: result.id,
              category: result.category,
              requires_reply: finalRequiresReply,
              urgency: result.urgency || 'medium',
              confidence: result.confidence || 0.8,
              classified_by: 'ai',
              classified_at: new Date().toISOString(),
              status: 'classified'
            })
          }
          
          // Handle any emails that weren't in the response
          for (const email of chunk) {
            if (!parsed.find(r => r.id === email.id)) {
              aiResults.push({
                id: email.id,
                status: 'pending', // Reset to pending for retry
                classified_by: null
              })
            }
          }
          
        } catch (aiError: any) {
          console.error('[classify-emails] AI batch error:', aiError.message)
          // Mark as failed, will retry later
          for (const email of chunk) {
            aiResults.push({
              id: email.id,
              status: 'pending',
              classified_by: null
            })
          }
        }
      }
    }

    // =========================================
    // STEP 7: Bulk update results
    // =========================================
    
    const allResults = [...rulesResults, ...aiResults]
    
    if (allResults.length > 0) {
      // Split into successful and failed
      const successful = allResults.filter(r => r.classified_by)
      const failed = allResults.filter(r => !r.classified_by)
      
      if (successful.length > 0) {
        const { error: updateError } = await supabase
          .from('raw_emails')
          .upsert(successful, { onConflict: 'id' })
        
        if (updateError) {
          console.error('[classify-emails] Update error:', updateError)
        }
      }
      
      // Reset failed ones to pending
      if (failed.length > 0) {
        await supabase
          .from('raw_emails')
          .update({ status: 'pending' })
          .in('id', failed.map(f => f.id))
      }
    }

    const duration = Date.now() - startTime
    console.log(`[classify-emails] Completed in ${duration}ms`)

    return new Response(JSON.stringify({
      success: true,
      processed: emails.length,
      rules_classified: rulesResults.length,
      ai_classified: aiResults.filter(r => r.classified_by === 'ai').length,
      failed: aiResults.filter(r => !r.classified_by).length,
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[classify-emails] Error:', error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
