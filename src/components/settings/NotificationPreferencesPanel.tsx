import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Bell, Mail, MessageSquare, Smartphone, Clock, Plus, X, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface NotificationPreferences {
  id?: string;
  workspace_id?: string;
  summary_enabled: boolean;
  summary_channels: string[];
  summary_times: string[];
  summary_email: string;
  summary_phone: string;
  timezone: string;
}

const DEFAULT_TIMES = ['08:00', '12:00', '18:00'];

export const NotificationPreferencesPanel = () => {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    summary_enabled: true,
    summary_channels: ['in_app'],
    summary_times: DEFAULT_TIMES,
    summary_email: '',
    summary_phone: '',
    timezone: 'Europe/London',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      // Get workspace ID
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data: userProfile } = await supabase
        .from('users')
        .select('workspace_id, email')
        .eq('id', userData.user.id)
        .single();

      if (!userProfile?.workspace_id) return;
      setWorkspaceId(userProfile.workspace_id);

      // Get existing preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('workspace_id', userProfile.workspace_id)
        .single();

      if (prefs) {
        setPreferences({
          ...prefs,
          summary_channels: prefs.summary_channels || ['in_app'],
          summary_times: prefs.summary_times || DEFAULT_TIMES,
          summary_email: prefs.summary_email || userProfile.email || '',
          summary_phone: prefs.summary_phone || '',
        });
      } else {
        // Set default email
        setPreferences(prev => ({
          ...prev,
          summary_email: userProfile.email || '',
        }));
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          workspace_id: workspaceId,
          summary_enabled: preferences.summary_enabled,
          summary_channels: preferences.summary_channels,
          summary_times: preferences.summary_times,
          summary_email: preferences.summary_email || null,
          summary_phone: preferences.summary_phone || null,
          timezone: preferences.timezone,
        }, { onConflict: 'workspace_id' });

      if (error) throw error;
      toast.success('Notification preferences saved');
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (channel: string) => {
    setPreferences(prev => ({
      ...prev,
      summary_channels: prev.summary_channels.includes(channel)
        ? prev.summary_channels.filter(c => c !== channel)
        : [...prev.summary_channels, channel],
    }));
  };

  const addTime = () => {
    const newTime = '09:00';
    if (!preferences.summary_times.includes(newTime)) {
      setPreferences(prev => ({
        ...prev,
        summary_times: [...prev.summary_times, newTime].sort(),
      }));
    }
  };

  const removeTime = (time: string) => {
    setPreferences(prev => ({
      ...prev,
      summary_times: prev.summary_times.filter(t => t !== time),
    }));
  };

  const updateTime = (oldTime: string, newTime: string) => {
    setPreferences(prev => ({
      ...prev,
      summary_times: prev.summary_times.map(t => t === oldTime ? newTime : t).sort(),
    }));
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            AI Summary Notifications
          </CardTitle>
          <CardDescription>
            Get briefed on your emails throughout the day via your preferred channels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable AI Summaries</Label>
              <p className="text-sm text-muted-foreground">
                Receive periodic briefings about your inbox activity
              </p>
            </div>
            <Switch
              checked={preferences.summary_enabled}
              onCheckedChange={(checked) => 
                setPreferences(prev => ({ ...prev, summary_enabled: checked }))
              }
            />
          </div>

          {preferences.summary_enabled && (
            <>
              {/* Notification Channels */}
              <div className="space-y-3">
                <Label>Notification Channels</Label>
                <div className="grid gap-3">
                  <div 
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      preferences.summary_channels.includes('in_app') 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:bg-muted/50'
                    }`}
                    onClick={() => toggleChannel('in_app')}
                  >
                    <Checkbox 
                      checked={preferences.summary_channels.includes('in_app')}
                      onCheckedChange={() => toggleChannel('in_app')}
                    />
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">In-App Notifications</p>
                      <p className="text-xs text-muted-foreground">See summaries in the notification bell</p>
                    </div>
                  </div>

                  <div 
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      preferences.summary_channels.includes('email') 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:bg-muted/50'
                    }`}
                    onClick={() => toggleChannel('email')}
                  >
                    <Checkbox 
                      checked={preferences.summary_channels.includes('email')}
                      onCheckedChange={() => toggleChannel('email')}
                    />
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">Email</p>
                      <p className="text-xs text-muted-foreground">Receive summaries to your email</p>
                    </div>
                  </div>

                  <div 
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      preferences.summary_channels.includes('sms') 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:bg-muted/50'
                    }`}
                    onClick={() => toggleChannel('sms')}
                  >
                    <Checkbox 
                      checked={preferences.summary_channels.includes('sms')}
                      onCheckedChange={() => toggleChannel('sms')}
                    />
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">SMS</p>
                      <p className="text-xs text-muted-foreground">Get text message briefings</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact Details */}
              {preferences.summary_channels.includes('email') && (
                <div className="space-y-2">
                  <Label htmlFor="summary_email">Email Address</Label>
                  <Input
                    id="summary_email"
                    type="email"
                    value={preferences.summary_email}
                    onChange={(e) => setPreferences(prev => ({ ...prev, summary_email: e.target.value }))}
                    placeholder="your@email.com"
                  />
                </div>
              )}

              {preferences.summary_channels.includes('sms') && (
                <div className="space-y-2">
                  <Label htmlFor="summary_phone">Phone Number</Label>
                  <Input
                    id="summary_phone"
                    type="tel"
                    value={preferences.summary_phone}
                    onChange={(e) => setPreferences(prev => ({ ...prev, summary_phone: e.target.value }))}
                    placeholder="+44 7123 456789"
                  />
                  <p className="text-xs text-muted-foreground">
                    Include country code (e.g., +44 for UK)
                  </p>
                </div>
              )}

              {/* Notification Times */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Notification Times
                  </Label>
                  <Button variant="outline" size="sm" onClick={addTime}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Time
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {preferences.summary_times.map((time) => (
                    <div 
                      key={time} 
                      className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2"
                    >
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => updateTime(time, e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                      />
                      <Badge variant="secondary" className="text-xs">
                        {formatTime(time)}
                      </Badge>
                      {preferences.summary_times.length > 1 && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-5 w-5"
                          onClick={() => removeTime(time)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Times are in your local timezone ({preferences.timezone})
                </p>
              </div>
            </>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Preferences'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
