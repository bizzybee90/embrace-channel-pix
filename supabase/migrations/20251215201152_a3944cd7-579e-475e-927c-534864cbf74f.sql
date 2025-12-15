-- Add email classification fields to conversations table
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS requires_reply boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS email_classification text DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.conversations.requires_reply IS 'Whether this conversation needs a response - false for spam, automated notifications, etc.';
COMMENT ON COLUMN public.conversations.email_classification IS 'Email type: customer_inquiry, automated_notification, spam_phishing, marketing_newsletter, recruitment_hr, receipt_confirmation, internal_system';