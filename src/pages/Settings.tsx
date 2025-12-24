import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DataExportPanel } from '@/components/settings/DataExportPanel';
import { DataDeletionPanel } from '@/components/settings/DataDeletionPanel';
import { AuditLogPanel } from '@/components/settings/AuditLogPanel';
import { RetentionPolicyPanel } from '@/components/settings/RetentionPolicyPanel';
import { TestDataCleanupPanel } from '@/components/settings/TestDataCleanupPanel';
import { GDPRDashboard } from '@/components/settings/GDPRDashboard';
import { CustomerMergePanel } from '@/components/settings/CustomerMergePanel';
import { ChannelManagementPanel } from '@/components/settings/ChannelManagementPanel';
import { AIAgentPanel } from '@/components/settings/AIAgentPanel';
import { ConversationOrderingPanel } from '@/components/settings/ConversationOrderingPanel';
import { KnowledgeBasePanel } from '@/components/settings/KnowledgeBasePanel';
import { DataSyncPanel } from '@/components/settings/DataSyncPanel';
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';
import { EmailSettingsPanel } from '@/components/settings/EmailSettingsPanel';
import { BusinessContextPanel } from '@/components/settings/BusinessContextPanel';
import { SenderRulesPanel } from '@/components/settings/SenderRulesPanel';
import { TriageLearningPanel } from '@/components/settings/TriageLearningPanel';
import { LearningSystemPanel } from '@/components/settings/LearningSystemPanel';
import { BehaviorStatsPanel } from '@/components/settings/BehaviorStatsPanel';
import { NotificationPreferencesPanel } from '@/components/settings/NotificationPreferencesPanel';
import { LowConfidenceWizard } from '@/components/settings/LowConfidenceWizard';
import { LearningAnalyticsDashboard } from '@/components/settings/LearningAnalyticsDashboard';
import { TestMessageGenerator } from '@/components/TestMessageGenerator';
import { BackButton } from '@/components/shared/BackButton';
import { Bot, Plug, Shield, Layout, Code, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsCategory {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  content: React.ReactNode;
}

export default function Settings() {
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const settingsCategories: SettingsCategory[] = [
    {
      id: 'ai',
      icon: Bot,
      title: 'BizzyBee AI',
      description: 'Agent configuration, knowledge base, and learning',
      content: (
        <div className="space-y-6">
          <AIAgentPanel />
          <KnowledgeBasePanel />
          <LearningAnalyticsDashboard />
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Email Triage Settings</h3>
            <LowConfidenceWizard />
            <LearningSystemPanel />
            <BehaviorStatsPanel />
            <BusinessContextPanel />
            <SenderRulesPanel />
            <TriageLearningPanel />
          </div>
        </div>
      )
    },
    {
      id: 'connections',
      icon: Plug,
      title: 'Connections',
      description: 'Email accounts, channels, and integrations',
      content: (
        <div className="space-y-6">
          <EmailSettingsPanel />
          <ChannelManagementPanel />
          <IntegrationsPanel />
          <DataSyncPanel />
        </div>
      )
    },
    {
      id: 'data',
      icon: Shield,
      title: 'Data & Privacy',
      description: 'GDPR compliance, exports, and retention',
      content: (
        <div className="space-y-6">
          <GDPRDashboard />
          <DataExportPanel />
          <DataDeletionPanel />
          <RetentionPolicyPanel />
          <AuditLogPanel />
        </div>
      )
    },
    {
      id: 'display',
      icon: Layout,
      title: 'Display & Behavior',
      description: 'Ordering preferences and notifications',
      content: (
        <div className="space-y-6">
          <ConversationOrderingPanel />
          <NotificationPreferencesPanel />
        </div>
      )
    },
    {
      id: 'developer',
      icon: Code,
      title: 'Developer Tools',
      description: 'Testing, cleanup, and diagnostics',
      content: (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Test Message Generator</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Generate test messages across different channels to verify AI agent behavior and conversation handling.
            </p>
            <TestMessageGenerator />
          </Card>
          <TestDataCleanupPanel />
          <CustomerMergePanel />
        </div>
      )
    }
  ];

  const handleToggle = (categoryId: string) => {
    setOpenCategory(openCategory === categoryId ? null : categoryId);
  };

  return (
    <div className="container mx-auto py-4 md:py-6 px-4 max-w-3xl">
      <div className="mb-6">
        <BackButton to="/" label="Back to Dashboard" />
        <h1 className="text-2xl md:text-3xl font-bold mt-2">Settings</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1">
          Manage your workspace configuration and preferences.
        </p>
      </div>

      <div className="space-y-3">
        {settingsCategories.map((category) => {
          const Icon = category.icon;
          const isOpen = openCategory === category.id;
          
          return (
            <Collapsible
              key={category.id}
              open={isOpen}
              onOpenChange={() => handleToggle(category.id)}
            >
              <Card className={cn(
                "transition-all duration-200",
                isOpen && "ring-2 ring-primary/20"
              )}>
                <CollapsibleTrigger className="w-full text-left">
                  <CardHeader className="flex flex-row items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-2 rounded-lg",
                        isOpen ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-medium">
                          {category.title}
                        </CardTitle>
                        <CardDescription className="text-sm">
                          {category.description}
                        </CardDescription>
                      </div>
                    </div>
                    <ChevronRight className={cn(
                      "h-5 w-5 text-muted-foreground transition-transform duration-200",
                      isOpen && "rotate-90"
                    )} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-6">
                    <div className="border-t pt-6">
                      {category.content}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
