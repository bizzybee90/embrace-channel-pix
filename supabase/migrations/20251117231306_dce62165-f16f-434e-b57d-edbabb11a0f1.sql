-- Create enum for message channels
CREATE TYPE public.message_channel AS ENUM ('sms', 'whatsapp', 'email', 'phone', 'webchat');

-- Create enum for message status
CREATE TYPE public.message_status AS ENUM ('pending', 'in_progress', 'responded', 'escalated');

-- Create escalated_messages table
CREATE TABLE public.escalated_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel public.message_channel NOT NULL,
  customer_name TEXT,
  customer_identifier TEXT NOT NULL, -- phone number, email, etc
  message_content TEXT NOT NULL,
  conversation_context JSONB, -- full conversation history
  priority TEXT DEFAULT 'medium',
  status public.message_status DEFAULT 'pending',
  escalated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  responded_at TIMESTAMP WITH TIME ZONE,
  n8n_workflow_id TEXT, -- to track which workflow it came from
  metadata JSONB, -- any additional data from N8n
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create message_responses table
CREATE TABLE public.message_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.escalated_messages(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  response_content TEXT NOT NULL,
  sent_to_n8n BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.escalated_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_responses ENABLE ROW LEVEL SECURITY;

-- RLS policies for escalated_messages (authenticated users can view and update)
CREATE POLICY "Authenticated users can view messages"
  ON public.escalated_messages
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update messages"
  ON public.escalated_messages
  FOR UPDATE
  TO authenticated
  USING (true);

-- RLS policies for message_responses
CREATE POLICY "Authenticated users can view responses"
  ON public.message_responses
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create responses"
  ON public.message_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_escalated_messages_updated_at
  BEFORE UPDATE ON public.escalated_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.escalated_messages;