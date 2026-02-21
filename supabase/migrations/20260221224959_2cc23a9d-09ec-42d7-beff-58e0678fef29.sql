
-- Drop the partial unique index and create a proper unique constraint for ON CONFLICT
DROP INDEX IF EXISTS public.messages_conversation_external_id_uidx;
ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_external_id_key UNIQUE (conversation_id, external_id);
