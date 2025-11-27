import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Search, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface PriceItem {
  id: string;
  service_name: string;
  description: string | null;
  base_price: number | null;
  price_range: string | null;
  currency: string | null;
  unit: string | null;
}

export function PricingManager() {
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<PriceItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { workspace } = useWorkspace();

  const [formData, setFormData] = useState({
    service_name: '',
    description: '',
    base_price: '',
    price_range: '',
    currency: 'GBP',
    unit: '',
  });

  useEffect(() => {
    if (workspace) {
      loadPrices();
    }
  }, [workspace]);

  const loadPrices = async () => {
    try {
      const { data, error } = await supabase
        .from('price_list')
        .select('*')
        .order('service_name', { ascending: true });

      if (error) throw error;
      setPrices(data || []);
    } catch (error: any) {
      toast({
        title: 'Error loading pricing',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.service_name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Service name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const payload = {
        service_name: formData.service_name,
        description: formData.description || null,
        base_price: formData.base_price ? parseFloat(formData.base_price) : null,
        price_range: formData.price_range || null,
        currency: formData.currency,
        unit: formData.unit || null,
        workspace_id: workspace?.id,
      };

      if (editingPrice) {
        const { error } = await supabase
          .from('price_list')
          .update(payload)
          .eq('id', editingPrice.id);

        if (error) throw error;
        toast({ title: 'Price updated successfully' });
      } else {
        const { error } = await supabase.from('price_list').insert(payload);

        if (error) throw error;
        toast({ title: 'Price created successfully' });
      }

      setIsDialogOpen(false);
      resetForm();
      loadPrices();
    } catch (error: any) {
      toast({
        title: 'Error saving price',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (price: PriceItem) => {
    setEditingPrice(price);
    setFormData({
      service_name: price.service_name,
      description: price.description || '',
      base_price: price.base_price?.toString() || '',
      price_range: price.price_range || '',
      currency: price.currency || 'GBP',
      unit: price.unit || '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('price_list').delete().eq('id', id);

      if (error) throw error;
      toast({ title: 'Price deleted successfully' });
      loadPrices();
    } catch (error: any) {
      toast({
        title: 'Error deleting price',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const resetForm = () => {
    setFormData({
      service_name: '',
      description: '',
      base_price: '',
      price_range: '',
      currency: 'GBP',
      unit: '',
    });
    setEditingPrice(null);
  };

  const filteredPrices = prices.filter((price) =>
    price.service_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (price.description && price.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatPrice = (price: PriceItem) => {
    const currencySymbol = price.currency === 'GBP' ? '£' : price.currency === 'EUR' ? '€' : '$';
    if (price.base_price) {
      return `${currencySymbol}${price.base_price.toFixed(2)}`;
    }
    if (price.price_range) {
      return price.price_range;
    }
    return 'Contact for pricing';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Price
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPrice ? 'Edit Price' : 'Add New Price'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="service_name">Service Name *</Label>
                <Input
                  id="service_name"
                  value={formData.service_name}
                  onChange={(e) => setFormData({ ...formData, service_name: e.target.value })}
                  placeholder="e.g., Consultation, Repair Service"
                  required
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of the service..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="base_price">Base Price</Label>
                  <Input
                    id="base_price"
                    type="number"
                    step="0.01"
                    value={formData.base_price}
                    onChange={(e) => setFormData({ ...formData, base_price: e.target.value })}
                    placeholder="99.99"
                  />
                </div>

                <div>
                  <Label htmlFor="currency">Currency</Label>
                  <select
                    id="currency"
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full px-3 py-2 border border-input bg-background rounded-md"
                  >
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="price_range">Price Range (alternative to base price)</Label>
                <Input
                  id="price_range"
                  value={formData.price_range}
                  onChange={(e) => setFormData({ ...formData, price_range: e.target.value })}
                  placeholder="e.g., £50-£100"
                />
                <p className="text-xs text-muted-foreground mt-1">Use when pricing varies</p>
              </div>

              <div>
                <Label htmlFor="unit">Unit</Label>
                <Input
                  id="unit"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="e.g., per hour, per session, one-time"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingPrice ? 'Update' : 'Create'} Price</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {filteredPrices.length === 0 ? (
        <Card className="p-12 text-center">
          <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No pricing yet</h3>
          <p className="text-muted-foreground mb-4">Add your service pricing to help customers understand costs</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredPrices.map((price) => (
            <Card key={price.id} className="p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1">
                  <h4 className="font-semibold mb-1">{price.service_name}</h4>
                  <div className="text-2xl font-bold text-primary mb-1">{formatPrice(price)}</div>
                  {price.unit && <div className="text-xs text-muted-foreground">{price.unit}</div>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(price)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(price.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {price.description && (
                <p className="text-sm text-muted-foreground">{price.description}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Price</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this price? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
