import { onDocumentUpdated } from "firebase-functions/v2/firestore";



/**
 * "The Clock"
 * Monitors updates to conversations to enforce SLAs.
 * 
 * Note: Real-time SLA monitoring usually requires a scheduled function (cron) 
 * to check for breaches, because onUpdated only fires on change.
 * However, the user request specifically asked for `onConversationUpdated` trigger logic.
 * We can implement logic here that *reacts* to changes (e.g. if priority changes, re-calc SLA),
 * effectively enabling "The Clock" to reset or escalate immediately on interaction.
 */
export const onConversationUpdated = onDocumentUpdated({
    document: "conversations/{convId}",
    region: "europe-west2",
    memory: "2GiB",
    timeoutSeconds: 540
}, async (event) => {
    const change = event.data;
    if (!change) return;

    const newData = change.after.data();


    // Prevent infinite loops
    if (newData.status === 'escalated') return;

    // Check SLA: Simple Logic
    // If priority is high and age > X, escalate.
    // NOTE: This only runs when the doc is UPDATED. So it catches "slow replies" 
    // only if something else updates the doc (like a new message or user action).

    // SLA Limits (in minutes)
    const SLA_LIMITS = {
        high: 60,     // 1 hour
        medium: 240,  // 4 hours
        low: 1440     // 24 hours
    };

    const priority = (newData.priority || 'medium') as keyof typeof SLA_LIMITS;
    const limit = SLA_LIMITS[priority];

    const createdAt = newData.created_at?.toDate ? newData.created_at.toDate() : new Date(newData.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / 60000;

    if (diffMinutes > limit && newData.status !== 'resolved') {
        console.log(`SLA Breached for ${event.params.convId}. Escalating.`);

        await change.after.ref.update({
            status: 'escalated',
            sla_status: 'breached',
            // 'lane' isn't in our schema explicitly but implied by status or category?
            // User asked to update `lane` to `escalation_hub`. 
            // We'll add it to metadata or assume status 'escalated' puts it there.
            "metadata.lane": "escalation_hub"
        });
    }
});
