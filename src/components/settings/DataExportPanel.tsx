import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const DataExportPanel = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast.error('Please enter a search term');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
        .limit(10);

      if (error) throw error;
      setCustomers(data || []);
      
      if (!data || data.length === 0) {
        toast.info('No customers found');
      }
    } catch (error: any) {
      toast.error('Failed to search customers: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (customerId: string, customerName: string) => {
    setLoading(true);
    try {
      // Fetch all customer data
      const [conversationsRes, consentsRes, deletionReqRes] = await Promise.all([
        supabase
          .from('conversations')
          .select('*, messages(*)')
          .eq('customer_id', customerId),
        supabase
          .from('customer_consents')
          .select('*')
          .eq('customer_id', customerId),
        supabase
          .from('data_deletion_requests')
          .select('*')
          .eq('customer_id', customerId),
      ]);

      const customerData = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();

      const exportData = {
        customer: customerData.data,
        conversations: conversationsRes.data || [],
        consents: consentsRes.data || [],
        deletion_requests: deletionReqRes.data || [],
        exported_at: new Date().toISOString(),
      };

      // Log the export action
      await supabase.from('data_access_logs').insert({
        customer_id: customerId,
        action: 'export',
        metadata: { exported_records: conversationsRes.data?.length || 0 }
      });

      // Create and download JSON file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customer-${customerName.replace(/\s/g, '_')}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Customer data exported successfully');
    } catch (error: any) {
      toast.error('Failed to export data: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Export Customer Data</h3>
          <p className="text-sm text-muted-foreground">
            GDPR compliance: Export all data associated with a customer (Right to Data Portability - Article 20)
          </p>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="search">Search by Name or Email</Label>
            <Input
              id="search"
              placeholder="Enter customer name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch} disabled={loading} className="mt-auto">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </div>

        {customers.length > 0 && (
          <div className="space-y-2 mt-4">
            <h4 className="font-medium">Search Results</h4>
            {customers.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">{customer.name}</p>
                  <p className="text-sm text-muted-foreground">{customer.email}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleExport(customer.id, customer.name)}
                  disabled={loading}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
