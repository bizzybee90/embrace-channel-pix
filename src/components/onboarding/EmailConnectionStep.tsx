import { useState } from "react";
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from "@/components/ui/button";
import { functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";

interface EmailConnectionStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function EmailConnectionStep({ onNext, onBack }: EmailConnectionStepProps) {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false); // In real app, check workspace status

  const handleConnect = async () => {
    setLoading(true);
    try {
      const startGmailAuth = httpsCallable(functions, 'startGmailAuth');
      const result = await startGmailAuth();
      const { url } = result.data as { url: string };

      // Redirect to Google Auth
      window.location.href = url;
      // Note: The app will reload after callback. 
      // Ideally, we'd handle the 'code' query param on re-entry to this step
      // or a dedicated callback page that redirects back here.

    } catch (error) {
      console.error("Error starting Gmail auth:", error);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-4 py-8">
        <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
          <Mail className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-xl font-semibold">Connect your Inbox</h3>
        <p className="text-muted-foreground max-w-sm mx-auto">
          BizzyBee connects to your Gmail to read emails, draft replies, and learn from your history.
        </p>
      </div>

      <div className="bg-muted p-4 rounded-lg border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white p-2 rounded border">
              <img src="https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png" alt="Gmail" className="w-6 h-6" />
            </div>
            <div>
              <p className="font-medium">Gmail / Google Workspace</p>
              <p className="text-xs text-muted-foreground">Secure OAuth 2.0 Connection</p>
            </div>
          </div>
          {connected ? (
            <Button variant="outline" className="text-green-600 border-green-200 bg-green-50" disabled>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Connected
            </Button>
          ) : (
            <Button onClick={handleConnect} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Connect"}
            </Button>
          )}
        </div>
      </div>

      <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800">
        <strong>Note:</strong> You will be redirected to Google to authorize access.
      </div>

      <div className="flex gap-3 pt-4">
        <Button variant="outline" onClick={onBack} disabled={loading} className="w-1/3">
          Back
        </Button>
        <Button onClick={onNext} className="w-2/3" size="lg" disabled={loading}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
