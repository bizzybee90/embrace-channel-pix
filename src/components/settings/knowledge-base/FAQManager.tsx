import { useState, useEffect } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, Search, HelpCircle, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[] | null;
  priority: number | null;
  type?: 'faq';
}

export function FAQManager() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQ | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { workspace } = useWorkspace();
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    category: '',
    question: '',
    answer: '',
    keywords: '',
    priority: 5,
  });

  useEffect(() => {
    if (workspace?.id) {
      loadFAQs();
    }
  }, [workspace]);

  const loadFAQs = async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const kbRef = collection(db, 'workspaces', workspace.id, 'knowledge_base');
      // Firestore composite indexes might be needed for ordering by priority.
      // For now, simplify query and sort in memory if needed or just query where type == 'faq'
      const q = query(kbRef, where('type', '==', 'faq'));
      const snapshot = await getDocs(q);

      const loadedFaqs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FAQ[];

      // Sort by priority locally
      loadedFaqs.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      setFaqs(loadedFaqs);
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error loading FAQs',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.question.trim() || !formData.answer.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Question and answer are required',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const keywordsArray = formData.keywords
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const payload = {
        type: 'faq',
        category: formData.category || 'general',
        question: formData.question,
        answer: formData.answer,
        keywords: keywordsArray.length > 0 ? keywordsArray : null,
        priority: formData.priority,
        updated_at: new Date().toISOString()
      };

      const kbRef = collection(db, 'workspaces', workspace!.id, 'knowledge_base');

      if (editingFaq) {
        await updateDoc(doc(kbRef, editingFaq.id), payload);
        toast({ title: 'FAQ updated successfully' });
      } else {
        await addDoc(kbRef, {
          ...payload,
          created_at: new Date().toISOString()
        });
        toast({ title: 'FAQ created successfully' });
      }

      setIsDialogOpen(false);
      resetForm();
      loadFAQs();
    } catch (error: any) {
      toast({
        title: 'Error saving FAQ',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (faq: FAQ) => {
    setEditingFaq(faq);
    setFormData({
      category: faq.category,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords?.join(', ') || '',
      priority: faq.priority || 5,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      if (!workspace?.id) return;
      await deleteDoc(doc(db, 'workspaces', workspace.id, 'knowledge_base', id));
      toast({ title: 'FAQ deleted successfully' });
      loadFAQs();
    } catch (error: any) {
      toast({
        title: 'Error deleting FAQ',
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
      question: '',
      answer: '',
      keywords: '',
      priority: 5,
    });
    setEditingFaq(null);
  };

  const filteredFaqs = faqs.filter((faq) => {
    const matchesSearch =
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || faq.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...new Set(faqs.map((f) => f.category))];

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
              placeholder="Search FAQs..."
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
              Add FAQ
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingFaq ? 'Edit FAQ' : 'Add New FAQ'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., Pricing, Hours, Services"
                />
              </div>

              <div>
                <Label htmlFor="question">Question *</Label>
                <Input
                  id="question"
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  placeholder="What is your question?"
                  required
                />
              </div>

              <div>
                <Label htmlFor="answer">Answer *</Label>
                <Textarea
                  id="answer"
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  placeholder="Provide a clear answer..."
                  rows={6}
                  required
                />
              </div>

              <div>
                <Label htmlFor="keywords">Keywords</Label>
                <Input
                  id="keywords"
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  placeholder="keyword1, keyword2, keyword3"
                />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated keywords for better matching</p>
              </div>

              <div>
                <Label htmlFor="priority">Priority (0-10)</Label>
                <Input
                  id="priority"
                  type="number"
                  min="0"
                  max="10"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground mt-1">Higher priority FAQs are checked first</p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingFaq ? 'Update' : 'Create'} FAQ
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {filteredFaqs.length === 0 ? (
        <Card className="p-12 text-center">
          {/* Empty State */}
          <HelpCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No FAQs yet</h3>
          <p className="text-muted-foreground mb-4">Start building your knowledge base by adding your first FAQ</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredFaqs.map((faq) => (
            <Card key={faq.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                      {faq.category}
                    </span>
                    {faq.priority !== null && faq.priority > 5 && (
                      <span className="text-xs bg-accent/10 text-accent px-2 py-1 rounded">
                        Priority: {faq.priority}
                      </span>
                    )}
                  </div>
                  <h4 className="font-semibold mb-2">{faq.question}</h4>
                  <p className="text-sm text-muted-foreground">{faq.answer}</p>
                  {faq.keywords && faq.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {faq.keywords.map((keyword, idx) => (
                        <span key={idx} className="text-xs bg-muted px-2 py-1 rounded">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(faq)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(faq.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete FAQ</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this FAQ? This action cannot be undone.
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
