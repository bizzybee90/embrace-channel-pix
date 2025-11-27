import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { FAQManager } from './knowledge-base/FAQManager';
import { BusinessFactsManager } from './knowledge-base/BusinessFactsManager';
import { PricingManager } from './knowledge-base/PricingManager';
import { HelpCircle, BookOpen, DollarSign } from 'lucide-react';

export function KnowledgeBasePanel() {
  return (
    <Card className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Knowledge Base</h2>
        <p className="text-muted-foreground">
          Manage your AI agent's knowledge base. Add FAQs, business facts, and pricing information
          that the AI will use to answer customer questions accurately.
        </p>
      </div>

      <Tabs defaultValue="faqs" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
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
      </Tabs>
    </Card>
  );
}
