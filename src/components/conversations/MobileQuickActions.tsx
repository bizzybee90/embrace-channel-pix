import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { CheckCircle2, Clock, UserPlus, Menu } from 'lucide-react';
import { QuickActions } from './QuickActions';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface MobileQuickActionsProps {
  conversation: Conversation;
  onUpdate: () => void;
  onClose: () => void;
}

export const MobileQuickActions = ({ conversation, onUpdate, onClose }: MobileQuickActionsProps) => {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button 
          variant="outline" 
          size="icon"
          className="fixed bottom-4 right-4 h-14 w-14 rounded-full shadow-lg z-50 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Menu className="h-6 w-6" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>Actions & Customer Info</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-8">
          <Tabs defaultValue="actions" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="actions">Quick Actions</TabsTrigger>
              <TabsTrigger value="customer">Customer</TabsTrigger>
            </TabsList>
            <TabsContent value="actions" className="space-y-4">
              <QuickActions 
                conversation={conversation} 
                onUpdate={onUpdate}
                onBack={onClose}
              />
            </TabsContent>
            <TabsContent value="customer">
              <CustomerContext conversation={conversation} onUpdate={onUpdate} />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
};