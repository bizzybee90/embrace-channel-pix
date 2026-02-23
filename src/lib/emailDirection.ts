// Direction detection by checking from_email domain
// The `direction` column in email_import_queue is unreliable
const OWNER_DOMAINS = ['maccleaning.uk', 'maccleaning.co.uk'];

export const isOutbound = (fromEmail: string | null): boolean =>
  OWNER_DOMAINS.some(d => fromEmail?.toLowerCase().endsWith(`@${d}`) ?? false);

export const isInbound = (fromEmail: string | null): boolean =>
  !isOutbound(fromEmail);

// Category color mapping
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  lead_new: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', label: 'New Lead' },
  customer_inquiry: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Enquiry' },
  inquiry: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Enquiry' },
  lead_followup: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: 'Follow-up' },
  quote: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: 'Quote' },
  customer_complaint: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Complaint' },
  complaint: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Complaint' },
  booking: { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-400', label: 'Booking' },
  automated_notification: { bg: 'bg-slate-100 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400', label: 'Notification' },
  notification: { bg: 'bg-slate-100 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400', label: 'Notification' },
  receipt_confirmation: { bg: 'bg-slate-100 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400', label: 'Receipt' },
  marketing_newsletter: { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-400', label: 'Newsletter' },
  follow_up: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: 'Follow-up' },
  personal: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-400', label: 'Personal' },
  spam: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Spam' },
};

export const getCategoryInfo = (category: string | null) => {
  if (!category) return { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Uncategorized' };
  return CATEGORY_COLORS[category] || { bg: 'bg-muted', text: 'text-muted-foreground', label: category.replace(/_/g, ' ') };
};

// Folder definitions
export type InboxFolder = 'inbox' | 'sent' | 'needs-reply' | 'ai-review' | 'noise' | 'all';

export const FOLDER_CONFIG: Record<InboxFolder, { label: string; icon: string }> = {
  'inbox': { label: 'Inbox', icon: 'Inbox' },
  'sent': { label: 'Sent', icon: 'Send' },
  'needs-reply': { label: 'Needs Reply', icon: 'Mail' },
  'ai-review': { label: 'AI Review', icon: 'Sparkles' },
  'noise': { label: 'Spam & Noise', icon: 'Ban' },
  'all': { label: 'All Mail', icon: 'Archive' },
};

// Category filter groups
export const CATEGORY_GROUPS = [
  { key: 'lead_new', label: 'New Leads', categories: ['lead_new'] },
  { key: 'inquiry', label: 'Inquiries', categories: ['customer_inquiry', 'inquiry'] },
  { key: 'followup', label: 'Follow-ups', categories: ['lead_followup', 'quote', 'follow_up'] },
  { key: 'complaint', label: 'Complaints', categories: ['customer_complaint', 'complaint'] },
  { key: 'booking', label: 'Bookings', categories: ['booking'] },
  { key: 'notification', label: 'Notifications', categories: ['automated_notification', 'notification', 'receipt_confirmation'] },
  { key: 'newsletter', label: 'Newsletters', categories: ['marketing_newsletter'] },
];

// Format relative time
export const formatEmailTime = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (isYesterday) return 'Yesterday';
  
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
