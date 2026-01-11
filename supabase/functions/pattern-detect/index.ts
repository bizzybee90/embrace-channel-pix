import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PatternRequest {
  workspace_id: string;
  action: 'analyze' | 'list' | 'mark_read';
  period_days?: number;
  insight_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'pattern-detect';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: PatternRequest = await req.json();
    console.log(`[${functionName}] Request:`, body);

    if (!body.workspace_id) throw new Error('workspace_id is required');

    const action = body.action || 'analyze';
    const periodDays = body.period_days || 7;

    // List existing insights
    if (action === 'list') {
      const { data: insights, error } = await supabase
        .from('inbox_insights')
        .select('*')
        .eq('workspace_id', body.workspace_id)
        .order('created_at', { ascending: false })
        .limit(50);

      return new Response(
        JSON.stringify({ success: true, insights: insights || [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark insight as read
    if (action === 'mark_read' && body.insight_id) {
      await supabase
        .from('inbox_insights')
        .update({ is_read: true })
        .eq('id', body.insight_id)
        .eq('workspace_id', body.workspace_id);

      return new Response(
        JSON.stringify({ success: true, message: 'Insight marked as read' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Analyze patterns
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = new Date().toISOString();

    // Get conversations from the period
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id, category, priority, status, urgency, ai_sentiment, created_at, channel, requires_reply, auto_responded')
      .eq('workspace_id', body.workspace_id)
      .gte('created_at', periodStart)
      .order('created_at', { ascending: false });

    if (!conversations || conversations.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No conversations to analyze in this period',
          insights: []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate metrics
    const totalConversations = conversations.length;
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const bySentiment: Record<string, number> = {};
    const byChannel: Record<string, number> = {};
    const byHour: Record<number, number> = {};
    const byDayOfWeek: Record<number, number> = {};
    
    let autoHandled = 0;
    let needsReply = 0;
    let urgent = 0;

    conversations.forEach(c => {
      // Category counts
      const cat = c.category || 'uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;

      // Priority counts
      const pri = c.priority || 'medium';
      byPriority[pri] = (byPriority[pri] || 0) + 1;

      // Sentiment counts
      const sent = c.ai_sentiment || 'neutral';
      bySentiment[sent] = (bySentiment[sent] || 0) + 1;

      // Channel counts
      const chan = c.channel || 'email';
      byChannel[chan] = (byChannel[chan] || 0) + 1;

      // Time patterns
      const date = new Date(c.created_at);
      const hour = date.getHours();
      const day = date.getDay();
      byHour[hour] = (byHour[hour] || 0) + 1;
      byDayOfWeek[day] = (byDayOfWeek[day] || 0) + 1;

      // Counts
      if (c.auto_responded) autoHandled++;
      if (c.requires_reply) needsReply++;
      if (c.urgency === 'high' || c.priority === 'high') urgent++;
    });

    // Find patterns and insights
    const insights: any[] = [];

    // Most common category
    const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    if (topCategory && topCategory[1] >= 3) {
      insights.push({
        insight_type: 'category_trend',
        title: `"${topCategory[0]}" is your most common inquiry`,
        description: `${topCategory[1]} of ${totalConversations} conversations (${Math.round(topCategory[1]/totalConversations*100)}%) were about ${topCategory[0]}. Consider creating more FAQs for this topic.`,
        severity: 'info',
        is_actionable: true,
        metrics: { category: topCategory[0], count: topCategory[1], percentage: Math.round(topCategory[1]/totalConversations*100) }
      });
    }

    // Negative sentiment trend
    const negativeSentiment = bySentiment['negative'] || 0;
    const negativePercentage = Math.round(negativeSentiment / totalConversations * 100);
    if (negativePercentage > 20) {
      insights.push({
        insight_type: 'sentiment_alert',
        title: 'High negative sentiment detected',
        description: `${negativePercentage}% of conversations had negative sentiment. Review these conversations to identify common issues.`,
        severity: 'warning',
        is_actionable: true,
        metrics: { negative_count: negativeSentiment, percentage: negativePercentage }
      });
    }

    // Peak hour detection
    const peakHour = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
      const hourNum = parseInt(peakHour[0]);
      const hourLabel = hourNum < 12 ? `${hourNum}AM` : hourNum === 12 ? '12PM' : `${hourNum-12}PM`;
      insights.push({
        insight_type: 'peak_time',
        title: `Peak activity: ${hourLabel}`,
        description: `Most conversations arrive around ${hourLabel}. Plan your availability accordingly.`,
        severity: 'info',
        is_actionable: false,
        metrics: { peak_hour: hourNum, count: peakHour[1] }
      });
    }

    // Auto-handling rate
    const autoRate = Math.round(autoHandled / totalConversations * 100);
    if (autoRate < 30 && totalConversations > 10) {
      insights.push({
        insight_type: 'automation_opportunity',
        title: 'Low automation rate',
        description: `Only ${autoRate}% of conversations were auto-handled. Review common questions to add more FAQs.`,
        severity: 'info',
        is_actionable: true,
        metrics: { auto_rate: autoRate, auto_handled: autoHandled }
      });
    } else if (autoRate > 70) {
      insights.push({
        insight_type: 'automation_success',
        title: 'Strong automation performance',
        description: `${autoRate}% of conversations were handled automatically. Great job building your knowledge base!`,
        severity: 'info',
        is_actionable: false,
        metrics: { auto_rate: autoRate, auto_handled: autoHandled }
      });
    }

    // Urgent conversations trend
    const urgentPercentage = Math.round(urgent / totalConversations * 100);
    if (urgentPercentage > 25) {
      insights.push({
        insight_type: 'urgency_alert',
        title: 'High volume of urgent requests',
        description: `${urgentPercentage}% of conversations were marked urgent. Consider reviewing your triage rules.`,
        severity: 'warning',
        is_actionable: true,
        metrics: { urgent_count: urgent, percentage: urgentPercentage }
      });
    }

    // Weekend volume check
    const weekendVolume = (byDayOfWeek[0] || 0) + (byDayOfWeek[6] || 0);
    const weekendPercentage = Math.round(weekendVolume / totalConversations * 100);
    if (weekendPercentage > 30) {
      insights.push({
        insight_type: 'weekend_volume',
        title: 'High weekend activity',
        description: `${weekendPercentage}% of conversations arrive on weekends. Consider setting expectations about weekend response times.`,
        severity: 'info',
        is_actionable: true,
        metrics: { weekend_volume: weekendVolume, percentage: weekendPercentage }
      });
    }

    // Add AI-generated deeper insights
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (LOVABLE_API_KEY && totalConversations >= 5) {
      try {
        const metricsContext = {
          period_days: periodDays,
          total_conversations: totalConversations,
          by_category: byCategory,
          by_priority: byPriority,
          by_sentiment: bySentiment,
          auto_handling_rate: autoRate,
          urgent_percentage: urgentPercentage,
          needs_reply: needsReply
        };

        const analysisPrompt = `Analyze these inbox metrics for a small business and generate 1-2 additional actionable insights:

${JSON.stringify(metricsContext, null, 2)}

Generate insights in JSON format:
[
  {
    "insight_type": "opportunity|issue|trend",
    "title": "Brief title",
    "description": "Detailed insight with specific recommendations",
    "severity": "info|warning",
    "is_actionable": true
  }
]

Focus on patterns not already covered and actionable recommendations.`;

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LOVABLE_API_KEY}`
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are a business analytics expert. Generate actionable insights from email metrics. Respond with valid JSON array only.' },
              { role: 'user', content: analysisPrompt }
            ],
            temperature: 0.3
          })
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const insightsText = aiData.choices?.[0]?.message?.content || '[]';
          
          try {
            const jsonMatch = insightsText.match(/\[[\s\S]*\]/);
            const aiInsights = JSON.parse(jsonMatch?.[0] || '[]');
            aiInsights.forEach((ai: any) => {
              insights.push({
                insight_type: ai.insight_type || 'opportunity',
                title: ai.title,
                description: ai.description,
                severity: ai.severity || 'info',
                is_actionable: ai.is_actionable ?? true,
                metrics: metricsContext
              });
            });
          } catch {
            console.log(`[${functionName}] Could not parse AI insights`);
          }
        }
      } catch (aiError) {
        console.log(`[${functionName}] AI analysis skipped:`, aiError);
      }
    }

    // Always add a summary insight at the start
    insights.unshift({
      insight_type: 'summary',
      title: `Week in Review: ${totalConversations} Conversations`,
      description: `You handled ${totalConversations} conversations this week. ${autoHandled} were auto-handled (${autoRate}%). ${urgent} were urgent.${negativeSentiment > 0 ? ` Watch: ${negativeSentiment} had negative sentiment.` : ''}`,
      severity: 'info',
      is_actionable: false,
      metrics: { total: totalConversations, auto_handled: autoHandled, urgent }
    });

    // Store insights
    if (insights.length > 0) {
      const insightsToStore = insights.map(insight => ({
        workspace_id: body.workspace_id,
        insight_type: insight.insight_type,
        title: insight.title,
        description: insight.description,
        severity: insight.severity,
        metrics: insight.metrics,
        period_start: periodStart,
        period_end: periodEnd,
        is_actionable: insight.is_actionable
      }));

      const { error: insertError } = await supabase
        .from('inbox_insights')
        .insert(insightsToStore);

      if (insertError) {
        console.error(`[${functionName}] Failed to store insights:`, insertError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Generated ${insights.length} insights in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        period: { start: periodStart, end: periodEnd, days: periodDays },
        metrics: {
          total_conversations: totalConversations,
          by_category: byCategory,
          by_priority: byPriority,
          by_sentiment: bySentiment,
          by_channel: byChannel,
          auto_handling_rate: autoRate,
          urgent_percentage: urgentPercentage
        },
        insights,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
