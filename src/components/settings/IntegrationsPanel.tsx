import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, ExternalLink, CheckCircle2, Copy } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const IntegrationsPanel = () => {
  const [testingTwilio, setTestingTwilio] = useState(false);

  const handleTestTwilio = async () => {
    setTestingTwilio(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-integration', {
        body: { service: 'twilio' }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Twilio connection verified');
      } else {
        toast.error(data?.message || 'Twilio connection failed');
      }
    } catch (err) {
      console.error('Twilio test error:', err);
      toast.error('Failed to test Twilio connection');
    } finally {
      setTestingTwilio(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const twilioWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/receive-message`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold mb-2">API Integrations</h2>
        <p className="text-muted-foreground">
          Manage your external service integrations for SMS and WhatsApp delivery
        </p>
      </div>

      {/* Twilio Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-600" />
            Twilio (SMS & WhatsApp)
          </CardTitle>
          <CardDescription>
            Send SMS and WhatsApp messages to customers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b">
            <span className="text-sm font-medium">Status</span>
            <Badge variant="default" className="bg-green-500 hover:bg-green-600">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <span className="text-sm font-medium">Phone Number</span>
            <code className="text-sm bg-muted px-2 py-1 rounded">+44 **** **588</code>
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <span className="text-sm font-medium">Account SID</span>
            <code className="text-sm bg-muted px-2 py-1 rounded">AC*********************</code>
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <span className="text-sm font-medium">Incoming Webhook URL</span>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted px-2 py-1 rounded max-w-[280px] truncate">
                {twilioWebhookUrl}
              </code>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={() => copyToClipboard(twilioWebhookUrl)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleTestTwilio}
              disabled={testingTwilio}
            >
              {testingTwilio ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button 
              variant="ghost" 
              size="sm"
              asChild
            >
              <a 
                href="https://console.twilio.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                Twilio Dashboard
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> Email is managed via the Channels tab using connected email accounts.
            API credentials are securely stored as environment secrets. 
            To update phone numbers or API keys, contact your workspace administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
