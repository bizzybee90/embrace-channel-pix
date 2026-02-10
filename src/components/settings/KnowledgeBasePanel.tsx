import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FAQManager } from './knowledge-base/FAQManager';
import { BusinessFactsManager } from './knowledge-base/BusinessFactsManager';
import { PricingManager } from './knowledge-base/PricingManager';
import { DocumentUpload } from '@/components/knowledge/DocumentUpload';
import { generateKnowledgeBasePDF } from './knowledge-base/generateKnowledgeBasePDF';
import { HelpCircle, BookOpen, DollarSign, FileUp, Download, Loader2 } from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { toast } from 'sonner';

export function KnowledgeBasePanel() {
  const { workspace } = useWorkspace();
  const [downloading, setDownloading] = useState(false);

  const handleDownloadPDF = async () => {
    if (!workspace?.id) return;
    setDownloading(true);
    try {
      await generateKnowledgeBasePDF(workspace.id, workspace.name || undefined);
      toast.success('Knowledge Base PDF downloaded!');
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Knowledge Base</h2>
          <p className="text-muted-foreground">
            Manage your AI agent's knowledge base. Add FAQs, business facts, pricing information,
            and upload documents that the AI will use to answer customer questions accurately.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={downloading || !workspace?.id}>
          {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Download PDF
        </Button>
      </div>

      <Tabs defaultValue="faqs" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="faqs" className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            FAQs
          </TabsTrigger>
          <TabsTrigger value="facts" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Business Facts
          </TabsTrigger>
          <TabsTrigger value="pricing" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Documents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="faqs">
          <FAQManager />
        </TabsContent>

        <TabsContent value="facts">
          <BusinessFactsManager />
        </TabsContent>

        <TabsContent value="pricing">
          <PricingManager />
        </TabsContent>

        <TabsContent value="documents">
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Upload PDF documents, price lists, or manuals. BizzyBee will extract FAQs and 
              key information to expand the knowledge base automatically.
            </div>
            {workspace?.id && (
              <DocumentUpload 
                workspaceId={workspace.id}
                onDocumentProcessed={() => {
                  // Could trigger a refresh of FAQs here if needed
                }}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
