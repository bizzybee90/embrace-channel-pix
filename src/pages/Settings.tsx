import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataExportPanel } from '@/components/settings/DataExportPanel';
import { DataDeletionPanel } from '@/components/settings/DataDeletionPanel';
import { AuditLogPanel } from '@/components/settings/AuditLogPanel';
import { RetentionPolicyPanel } from '@/components/settings/RetentionPolicyPanel';
import { InterfaceModeToggle } from '@/components/settings/InterfaceModeToggle';
import { TestDataCleanupPanel } from '@/components/settings/TestDataCleanupPanel';
import { GDPRDashboard } from '@/components/settings/GDPRDashboard';
import { CustomerMergePanel } from '@/components/settings/CustomerMergePanel';
import { ChannelManagementPanel } from '@/components/settings/ChannelManagementPanel';
import { AIActivityWidget } from '@/components/dashboard/AIActivityWidget';
import { AIAgentPanel } from '@/components/settings/AIAgentPanel';
import { ConversationOrderingPanel } from '@/components/settings/ConversationOrderingPanel';
import { KnowledgeBasePanel } from '@/components/settings/KnowledgeBasePanel';
import { DataSyncPanel } from '@/components/settings/DataSyncPanel';
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';
import { EmailSettingsPanel } from '@/components/settings/EmailSettingsPanel';
import { BusinessContextPanel } from '@/components/settings/BusinessContextPanel';
import { SenderRulesPanel } from '@/components/settings/SenderRulesPanel';
import { TriageLearningPanel } from '@/components/settings/TriageLearningPanel';
import { Card } from '@/components/ui/card';
import { TestMessageGenerator } from '@/components/TestMessageGenerator';
import { RecentActivityWidget } from '@/components/dashboard/RecentActivityWidget';
import { TestTube, Filter } from 'lucide-react';
import { BackButton } from '@/components/shared/BackButton';

export default function Settings() {
  return (
    <div className="container mx-auto py-4 md:py-6 px-4 max-w-6xl">
      <div className="mb-4 md:mb-6">
        <BackButton to="/" label="Back to Dashboard" />
        <h1 className="text-2xl md:text-3xl font-bold mt-2">Settings</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1 md:mt-2">Manage your workspace settings, GDPR compliance, and data policies.</p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4 md:space-y-6">
        <div className="overflow-x-auto pb-2 -mx-4 px-4">
          <TabsList className="inline-flex w-auto min-w-full">
            <TabsTrigger value="dashboard" className="text-xs md:text-sm">Dashboard</TabsTrigger>
            <TabsTrigger value="interface" className="text-xs md:text-sm">Interface</TabsTrigger>
            <TabsTrigger value="ordering" className="text-xs md:text-sm">Ordering</TabsTrigger>
            <TabsTrigger value="ai-agent" className="text-xs md:text-sm">AI Agent</TabsTrigger>
            <TabsTrigger value="testing" className="flex items-center gap-2 text-xs md:text-sm">
              <TestTube className="h-3 w-3 md:h-4 md:w-4" />
              Testing
            </TabsTrigger>
            <TabsTrigger value="knowledge-base" className="text-xs md:text-sm">Knowledge Base</TabsTrigger>
            <TabsTrigger value="data-sync" className="text-xs md:text-sm">Data Sync</TabsTrigger>
            <TabsTrigger value="integrations" className="text-xs md:text-sm">Integrations</TabsTrigger>
            <TabsTrigger value="channels" className="text-xs md:text-sm">Channels</TabsTrigger>
            <TabsTrigger value="email-settings" className="text-xs md:text-sm">Email</TabsTrigger>
            <TabsTrigger value="email-triage" className="flex items-center gap-2 text-xs md:text-sm">
              <Filter className="h-3 w-3 md:h-4 md:w-4" />
              Email Triage
            </TabsTrigger>
            <TabsTrigger value="gdpr" className="text-xs md:text-sm">GDPR</TabsTrigger>
            <TabsTrigger value="cleanup" className="text-xs md:text-sm">Cleanup</TabsTrigger>
            <TabsTrigger value="export" className="text-xs md:text-sm">Data Export</TabsTrigger>
            <TabsTrigger value="deletion" className="text-xs md:text-sm">Data Deletion</TabsTrigger>
            <TabsTrigger value="retention" className="text-xs md:text-sm">Retention</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs md:text-sm">Audit Logs</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <AIActivityWidget />
            <RecentActivityWidget />
          </div>
        </TabsContent>

        <TabsContent value="interface" className="space-y-4">
          <InterfaceModeToggle />
        </TabsContent>

        <TabsContent value="ordering">
          <ConversationOrderingPanel />
        </TabsContent>

        <TabsContent value="ai-agent">
          <AIAgentPanel />
        </TabsContent>

        <TabsContent value="testing" className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Test Message Generator</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Generate test messages across different channels to verify AI agent behavior and conversation handling.
            </p>
            <TestMessageGenerator />
          </Card>
        </TabsContent>

        <TabsContent value="knowledge-base">
          <KnowledgeBasePanel />
        </TabsContent>

        <TabsContent value="data-sync">
          <DataSyncPanel />
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsPanel />
        </TabsContent>

        <TabsContent value="channels">
          <ChannelManagementPanel />
        </TabsContent>

        <TabsContent value="email-settings">
          <EmailSettingsPanel />
        </TabsContent>

        <TabsContent value="email-triage" className="space-y-6">
          <BusinessContextPanel />
          <SenderRulesPanel />
          <TriageLearningPanel />
        </TabsContent>

        <TabsContent value="gdpr">
          <GDPRDashboard />
        </TabsContent>

        <TabsContent value="cleanup" className="space-y-6">
          <TestDataCleanupPanel />
          <CustomerMergePanel />
        </TabsContent>

        <TabsContent value="export">
          <DataExportPanel />
        </TabsContent>

        <TabsContent value="deletion">
          <DataDeletionPanel />
        </TabsContent>

        <TabsContent value="retention">
          <RetentionPolicyPanel />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
