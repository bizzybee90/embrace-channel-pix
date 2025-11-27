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
import { Plus, Edit, Trash2, Search, BookOpen } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface BusinessFact {
  id: string;
  category: string;
  fact_key: string;
  fact_value: string;
  metadata: any;
}

export function BusinessFactsManager() {
  const [facts, setFacts] = useState<BusinessFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<BusinessFact | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { workspace } = useWorkspace();

  const [formData, setFormData] = useState({
    category: '',
    fact_key: '',
    fact_value: '',
    metadata: '',
  });

  useEffect(() => {
    if (workspace) {
      loadFacts();
    }
  }, [workspace]);

  const loadFacts = async () => {
    try {
      const { data, error } = await supabase
        .from('business_facts')
        .select('*')
        .order('category', { ascending: true })
        .order('fact_key', { ascending: true });

      if (error) throw error;
      setFacts(data || []);
    } catch (error: any) {
      toast({
        title: 'Error loading business facts',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.category.trim() || !formData.fact_key.trim() || !formData.fact_value.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Category, key, and value are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      let metadata = null;
      if (formData.metadata.trim()) {
        try {
          metadata = JSON.parse(formData.metadata);
        } catch {
          toast({
            title: 'Invalid JSON',
            description: 'Metadata must be valid JSON',
            variant: 'destructive',
          });
          return;
        }
      }

      const payload = {
        category: formData.category,
        fact_key: formData.fact_key,
        fact_value: formData.fact_value,
        metadata,
        workspace_id: workspace?.id,
      };

      if (editingFact) {
        const { error } = await supabase
          .from('business_facts')
          .update(payload)
          .eq('id', editingFact.id);

        if (error) throw error;
        toast({ title: 'Business fact updated successfully' });
      } else {
        const { error } = await supabase.from('business_facts').insert(payload);

        if (error) throw error;
        toast({ title: 'Business fact created successfully' });
      }

      setIsDialogOpen(false);
      resetForm();
      loadFacts();
    } catch (error: any) {
      toast({
        title: 'Error saving business fact',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (fact: BusinessFact) => {
    setEditingFact(fact);
    setFormData({
      category: fact.category,
      fact_key: fact.fact_key,
      fact_value: fact.fact_value,
      metadata: fact.metadata ? JSON.stringify(fact.metadata, null, 2) : '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('business_facts').delete().eq('id', id);

      if (error) throw error;
      toast({ title: 'Business fact deleted successfully' });
      loadFacts();
    } catch (error: any) {
      toast({
        title: 'Error deleting business fact',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const resetForm = () => {
    setFormData({
      category: '',
      fact_key: '',
      fact_value: '',
      metadata: '',
    });
    setEditingFact(null);
  };

  const filteredFacts = facts.filter((fact) => {
    const matchesSearch =
      fact.fact_key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      fact.fact_value.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || fact.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...new Set(facts.map((f) => f.category))];

  const groupedFacts = filteredFacts.reduce((acc, fact) => {
    if (!acc[fact.category]) {
      acc[fact.category] = [];
    }
    acc[fact.category].push(fact);
    return acc;
  }, {} as Record<string, BusinessFact[]>);

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
        <div className="flex gap-2 flex-1 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search facts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-input bg-background rounded-md"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'all' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Fact
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingFact ? 'Edit Business Fact' : 'Add New Business Fact'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="category">Category *</Label>
                <Input
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., hours, location, contact, services"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">Group related facts together</p>
              </div>

              <div>
                <Label htmlFor="fact_key">Fact Key *</Label>
                <Input
                  id="fact_key"
                  value={formData.fact_key}
                  onChange={(e) => setFormData({ ...formData, fact_key: e.target.value })}
                  placeholder="e.g., opening_hours_monday, phone_number"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">Unique identifier for this fact</p>
              </div>

              <div>
                <Label htmlFor="fact_value">Fact Value *</Label>
                <Textarea
                  id="fact_value"
                  value={formData.fact_value}
                  onChange={(e) => setFormData({ ...formData, fact_value: e.target.value })}
                  placeholder="e.g., 9:00 AM - 5:00 PM, +44 20 1234 5678"
                  rows={4}
                  required
                />
              </div>

              <div>
                <Label htmlFor="metadata">Metadata (JSON, optional)</Label>
                <Textarea
                  id="metadata"
                  value={formData.metadata}
                  onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
                  placeholder='{"additional": "info"}'
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">Additional structured data in JSON format</p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingFact ? 'Update' : 'Create'} Fact</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {Object.keys(groupedFacts).length === 0 ? (
        <Card className="p-12 text-center">
          <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No business facts yet</h3>
          <p className="text-muted-foreground mb-4">Add facts about your business hours, location, services, and more</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedFacts).map(([category, categoryFacts]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold mb-3 capitalize">{category}</h3>
              <div className="space-y-2">
                {categoryFacts.map((fact) => (
                  <Card key={fact.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="font-medium text-sm text-muted-foreground mb-1">{fact.fact_key}</div>
                        <div className="text-sm">{fact.fact_value}</div>
                        {fact.metadata && (
                          <details className="mt-2">
                            <summary className="text-xs text-muted-foreground cursor-pointer">Metadata</summary>
                            <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                              {JSON.stringify(fact.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(fact)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(fact.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Business Fact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this fact? This action cannot be undone.
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
