import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataExportPanel } from '@/components/settings/DataExportPanel';
import { DataDeletionPanel } from '@/components/settings/DataDeletionPanel';
import { AuditLogPanel } from '@/components/settings/AuditLogPanel';
import { RetentionPolicyPanel } from '@/components/settings/RetentionPolicyPanel';
import { InterfaceModeToggle } from '@/components/settings/InterfaceModeToggle';
import { GDPRDashboard } from '@/components/settings/GDPRDashboard';
import { CustomerMergePanel } from '@/components/settings/CustomerMergePanel';
import { Card } from '@/components/ui/card';

export default function Settings() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your workspace settings, GDPR compliance, and data policies.</p>
      </div>

      <Tabs defaultValue="interface" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-7">
          <TabsTrigger value="interface">Interface</TabsTrigger>
          <TabsTrigger value="gdpr">GDPR</TabsTrigger>
          <TabsTrigger value="cleanup">Cleanup</TabsTrigger>
          <TabsTrigger value="export">Data Export</TabsTrigger>
          <TabsTrigger value="deletion">Data Deletion</TabsTrigger>
          <TabsTrigger value="retention">Retention Policy</TabsTrigger>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="interface" className="space-y-4">
          <InterfaceModeToggle />
        </TabsContent>

        <TabsContent value="gdpr">
          <GDPRDashboard />
        </TabsContent>

        <TabsContent value="cleanup">
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
