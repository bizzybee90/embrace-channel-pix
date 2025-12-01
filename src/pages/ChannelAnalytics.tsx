import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Clock, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

const channelColors: Record<string, string> = {
  email: '#3b82f6',
  whatsapp: '#22c55e',
  sms: '#a855f7',
  phone: '#f97316',
  webchat: '#6366f1'
};

interface AnalyticsData {
  volumeByDay: Array<{ date: string; total: number; [key: string]: any }>;
  volumeByHour: Array<{ hour: string; count: number }>;
  channelDistribution: Array<{ channel: string; count: number; percentage: number }>;
  responseTimesByDay: Array<{ date: string; avgMinutes: number }>;
  resolutionRate: { resolved: number; unresolved: number; rate: number };
  peakHours: Array<{ hour: number; count: number }>;
  statusDistribution: Array<{ status: string; count: number }>;
}

export default function ChannelAnalytics() {
  const { workspace } = useWorkspace();
  const [timeRange, setTimeRange] = useState('7');
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [hiddenChannels, setHiddenChannels] = useState<string[]>(() => {
    const saved = localStorage.getItem('hiddenAnalyticsChannels');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    if (workspace?.id) {
      fetchAnalytics();
    }
  }, [workspace?.id, timeRange]);

  const fetchAnalytics = async () => {
    if (!workspace?.id) return;
    
    setLoading(true);
    try {
      const daysBack = parseInt(timeRange);
      const startDate = subDays(new Date(), daysBack);
      
      // Fetch all conversations in the time range
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspace.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (conversations) {
        // Volume by day
        const volumeByDay: Record<string, any> = {};
        const volumeByHour: Record<number, number> = {};
        const channelCounts: Record<string, number> = {};
        const statusCounts: Record<string, number> = {};
        
        conversations.forEach(conv => {
          const date = format(parseISO(conv.created_at), 'MMM dd');
          const hour = parseISO(conv.created_at).getHours();
          
          // By day
          if (!volumeByDay[date]) {
            volumeByDay[date] = { date, total: 0 };
          }
          volumeByDay[date].total++;
          volumeByDay[date][conv.channel] = (volumeByDay[date][conv.channel] || 0) + 1;
          
          // By hour
          volumeByHour[hour] = (volumeByHour[hour] || 0) + 1;
          
          // By channel
          channelCounts[conv.channel] = (channelCounts[conv.channel] || 0) + 1;
          
          // By status
          statusCounts[conv.status || 'unknown'] = (statusCounts[conv.status || 'unknown'] || 0) + 1;
        });

        // Calculate response times by day
        const responseTimesByDay: Record<string, { sum: number; count: number }> = {};
        conversations
          .filter(c => c.first_response_at && c.created_at)
          .forEach(conv => {
            const date = format(parseISO(conv.created_at), 'MMM dd');
            const created = parseISO(conv.created_at).getTime();
            const responded = parseISO(conv.first_response_at!).getTime();
            const minutes = (responded - created) / 1000 / 60;
            
            if (!responseTimesByDay[date]) {
              responseTimesByDay[date] = { sum: 0, count: 0 };
            }
            responseTimesByDay[date].sum += minutes;
            responseTimesByDay[date].count++;
          });

        // Calculate resolution rate
        const resolved = conversations.filter(c => c.status === 'resolved').length;
        const unresolved = conversations.length - resolved;
        const resolutionRate = conversations.length > 0 
          ? (resolved / conversations.length) * 100 
          : 0;

        // Find peak hours (top 5)
        const peakHours = Object.entries(volumeByHour)
          .map(([hour, count]) => ({ hour: parseInt(hour), count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        // Channel distribution
        const totalConversations = conversations.length;
        const channelDistribution = Object.entries(channelCounts).map(([channel, count]) => ({
          channel,
          count,
          percentage: (count / totalConversations) * 100
        }));

        setAnalytics({
          volumeByDay: Object.values(volumeByDay),
          volumeByHour: Array.from({ length: 24 }, (_, i) => ({
            hour: `${i}:00`,
            count: volumeByHour[i] || 0
          })),
          channelDistribution,
          responseTimesByDay: Object.entries(responseTimesByDay).map(([date, data]) => ({
            date,
            avgMinutes: data.count > 0 ? data.sum / data.count : 0
          })),
          resolutionRate: {
            resolved,
            unresolved,
            rate: resolutionRate
          },
          peakHours: peakHours.sort((a, b) => a.hour - b.hour),
          statusDistribution: Object.entries(statusCounts).map(([status, count]) => ({
            status,
            count
          }))
        });
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const toggleChannelVisibility = (channel: string) => {
    const newHidden = hiddenChannels.includes(channel)
      ? hiddenChannels.filter(c => c !== channel)
      : [...hiddenChannels, channel];
    setHiddenChannels(newHidden);
    localStorage.setItem('hiddenAnalyticsChannels', JSON.stringify(newHidden));
  };

  // Filter analytics data based on hidden channels
  const filteredAnalytics = analytics ? {
    ...analytics,
    channelDistribution: analytics.channelDistribution.filter(
      ch => !hiddenChannels.includes(ch.channel)
    ),
    volumeByDay: analytics.volumeByDay.map(day => {
      const filtered: any = { date: day.date, total: 0 };
      Object.keys(day).forEach(key => {
        if (key !== 'date' && key !== 'total' && !hiddenChannels.includes(key)) {
          filtered[key] = day[key];
          filtered.total += day[key] || 0;
        }
      });
      return filtered;
    })
  } : null;

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={
        <div className="p-4 md:p-8 space-y-4 md:space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 md:gap-4">
            <div>
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Channel Analytics</h1>
              <p className="text-sm text-muted-foreground mt-1">Insights into channel performance and usage patterns</p>
            </div>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Channel visibility toggles */}
          {analytics && analytics.channelDistribution.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Channel Filters</CardTitle>
                <CardDescription>Toggle channels to show/hide from analytics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {analytics.channelDistribution.map(ch => (
                    <Button
                      key={ch.channel}
                      variant={hiddenChannels.includes(ch.channel) ? "outline" : "default"}
                      size="sm"
                      onClick={() => toggleChannelVisibility(ch.channel)}
                      className="gap-2"
                    >
                      {hiddenChannels.includes(ch.channel) ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      <span className="capitalize">{ch.channel}</span>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading analytics...</p>
              </div>
            </div>
          ) : !analytics ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No data available for the selected time range.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-xs md:text-sm font-medium">Total Conversations</CardTitle>
                    <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl md:text-2xl font-bold">
                      {filteredAnalytics?.volumeByDay.reduce((sum, day) => sum + day.total, 0) || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatMinutes(
                        analytics.responseTimesByDay.reduce((sum, day) => sum + day.avgMinutes, 0) / 
                        (analytics.responseTimesByDay.length || 1)
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Resolution Rate</CardTitle>
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.resolutionRate.rate.toFixed(1)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {analytics.resolutionRate.resolved} resolved
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Peak Hour</CardTitle>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.peakHours[0]?.hour}:00
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {analytics.peakHours[0]?.count} conversations
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="trends" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="trends">Trends</TabsTrigger>
                  <TabsTrigger value="distribution">Distribution</TabsTrigger>
                  <TabsTrigger value="performance">Performance</TabsTrigger>
                  <TabsTrigger value="peak-times">Peak Times</TabsTrigger>
                </TabsList>

                <TabsContent value="trends" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Volume Over Time</CardTitle>
                      <CardDescription>Daily conversation volume by channel</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={filteredAnalytics?.volumeByDay || []}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="total" stroke="#8884d8" strokeWidth={2} name="Total" />
                          {filteredAnalytics?.channelDistribution.map(ch => (
                            <Line 
                              key={ch.channel}
                              type="monotone" 
                              dataKey={ch.channel} 
                              stroke={channelColors[ch.channel]} 
                              name={ch.channel}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Response Time Trends</CardTitle>
                      <CardDescription>Average first response time by day</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={analytics.responseTimesByDay}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip formatter={(value: number) => formatMinutes(value)} />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="avgMinutes" 
                            stroke="#82ca9d" 
                            strokeWidth={2}
                            name="Avg Response Time"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="distribution" className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Channel Distribution</CardTitle>
                        <CardDescription>Conversation volume by channel</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={filteredAnalytics?.channelDistribution || []}
                              dataKey="count"
                              nameKey="channel"
                              cx="50%"
                              cy="50%"
                              outerRadius={100}
                              label={(entry) => `${entry.channel}: ${entry.percentage.toFixed(1)}%`}
                            >
                              {filteredAnalytics?.channelDistribution.map((entry, index) => (
                                <Cell key={entry.channel} fill={channelColors[entry.channel] || COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Status Distribution</CardTitle>
                        <CardDescription>Current conversation statuses</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={analytics.statusDistribution}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="status" />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="count" fill="#8884d8" />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Channel Breakdown</CardTitle>
                      <CardDescription>Detailed statistics by channel</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {filteredAnalytics?.channelDistribution
                          .sort((a, b) => b.count - a.count)
                          .map(channel => (
                            <div key={channel.channel} className="flex items-center justify-between p-3 border rounded-lg">
                              <div className="flex items-center gap-3">
                                <div 
                                  className="w-4 h-4 rounded-full" 
                                  style={{ backgroundColor: channelColors[channel.channel] }}
                                />
                                <span className="font-medium capitalize">{channel.channel}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                <Badge variant="secondary">{channel.count} conversations</Badge>
                                <span className="text-sm text-muted-foreground w-16 text-right">
                                  {channel.percentage.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="performance" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Resolution Metrics</CardTitle>
                      <CardDescription>Conversation resolution performance</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        <div>
                          <div className="flex justify-between mb-2">
                            <span className="text-sm font-medium">Resolution Rate</span>
                            <span className="text-sm font-bold">{analytics.resolutionRate.rate.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-3">
                            <div 
                              className="bg-green-500 h-3 rounded-full transition-all"
                              style={{ width: `${analytics.resolutionRate.rate}%` }}
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 border rounded-lg">
                            <p className="text-sm text-muted-foreground mb-1">Resolved</p>
                            <p className="text-2xl font-bold text-green-600">
                              {analytics.resolutionRate.resolved}
                            </p>
                          </div>
                          <div className="p-4 border rounded-lg">
                            <p className="text-sm text-muted-foreground mb-1">Unresolved</p>
                            <p className="text-2xl font-bold text-orange-600">
                              {analytics.resolutionRate.unresolved}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="peak-times" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Hourly Distribution</CardTitle>
                      <CardDescription>Conversation volume by hour of day</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analytics.volumeByHour}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="hour" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="count" fill="#8884d8" />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Peak Hours</CardTitle>
                      <CardDescription>Top 5 busiest hours</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {analytics.peakHours.map((peak, index) => (
                          <div key={peak.hour} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className="w-8 h-8 rounded-full flex items-center justify-center">
                                {index + 1}
                              </Badge>
                              <span className="font-medium">{peak.hour}:00 - {peak.hour + 1}:00</span>
                            </div>
                            <Badge>{peak.count} conversations</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      }
    />
  );
}
