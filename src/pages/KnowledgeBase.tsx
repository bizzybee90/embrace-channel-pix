import { useState, useEffect } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { 
  Search, Globe, Users, FileText, Star, Trash2, Edit, 
  Plus, BookOpen, Brain, ChevronDown, ChevronUp, ArrowLeft
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  source: string | null;
  priority?: number;
  created_at: string;
}

const getSourceIcon = (source: string | null) => {
  if (source?.includes('website')) return <Globe className="h-4 w-4 text-blue-500" />;
  if (source?.includes('competitor')) return <Users className="h-4 w-4 text-purple-500" />;
  if (source?.includes('document')) return <FileText className="h-4 w-4 text-amber-500" />;
  return <Star className="h-4 w-4 text-muted-foreground" />;
};

const getPriorityBadge = (priority: number = 0) => {
  if (priority >= 9) return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Your Content</Badge>;
  if (priority >= 7) return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">High Priority</Badge>;
  if (priority >= 5) return <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">Competitor</Badge>;
  return <Badge variant="secondary">Low</Badge>;
};

function FAQCard({ faq, onDelete }: { faq: FAQ; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const handleDelete = async () => {
    if (confirm('Delete this FAQ?')) {
      await supabase.from('faqs').delete().eq('id', faq.id);
      onDelete();
    }
  };

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {getSourceIcon(faq.source)}
              {getPriorityBadge(faq.priority ?? 0)}
            </div>
            
            <h3 className="font-medium text-foreground mb-2">{faq.question}</h3>
            
            <p className={`text-sm text-muted-foreground ${!expanded && faq.answer.length > 150 ? 'line-clamp-2' : ''}`}>
              {faq.answer}
            </p>
            
            {faq.answer.length > 150 && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="px-0 h-auto mt-1"
              >
                {expanded ? (
                  <span className="flex items-center gap-1">Show less <ChevronUp className="h-3 w-3" /></span>
                ) : (
                  <span className="flex items-center gap-1">Show more <ChevronDown className="h-3 w-3" /></span>
                )}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function KnowledgeBase() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (workspace?.id) {
      fetchFaqs();
    }
  }, [workspace?.id]);

  const fetchFaqs = async () => {
    if (!workspace?.id) return;
    
    const { data } = await supabase
      .from('faqs')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('priority', { ascending: false });
    
    setFaqs(data || []);
    setLoading(false);
  };

  // Group FAQs by source
  const groupedFaqs = {
    website: faqs.filter(f => f.source?.includes('website') || (f.priority ?? 0) >= 9),
    competitor: faqs.filter(f => f.source?.includes('competitor') || ((f.priority ?? 0) >= 5 && (f.priority ?? 0) < 9 && !f.source?.includes('website'))),
    document: faqs.filter(f => f.source?.includes('document')),
    manual: faqs.filter(f => f.source === 'manual' || !f.source)
  };

  const filteredFaqs = faqs.filter(faq => 
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filterByTab = (tabFaqs: FAQ[]) => {
    if (!searchQuery) return tabFaqs;
    return tabFaqs.filter(faq => 
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  if (workspaceLoading) {
    return (
      <div className="flex h-screen bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="hidden md:flex border-r border-border bg-card">
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          {/* Back Button */}
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to Dashboard</span>
          </Link>

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Brain className="h-5 w-5 text-primary" />
                </div>
                <h1 className="text-2xl font-bold">Knowledge Base</h1>
              </div>
              <p className="text-muted-foreground">
                Everything BizzyBee knows about your business
              </p>
            </div>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add FAQ
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Globe className="h-8 w-8 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold">{groupedFaqs.website.length}</p>
                    <p className="text-xs text-muted-foreground">From Your Website</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-purple-500" />
                  <div>
                    <p className="text-2xl font-bold">{groupedFaqs.competitor.length}</p>
                    <p className="text-xs text-muted-foreground">From Competitors</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-amber-500" />
                  <div>
                    <p className="text-2xl font-bold">{groupedFaqs.document.length}</p>
                    <p className="text-xs text-muted-foreground">From Documents</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <BookOpen className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold">{faqs.length}</p>
                    <p className="text-xs text-muted-foreground">Total FAQs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search FAQs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Tabs */}
          <Tabs defaultValue="all" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">All ({faqs.length})</TabsTrigger>
              <TabsTrigger value="website">Website ({groupedFaqs.website.length})</TabsTrigger>
              <TabsTrigger value="competitors">Competitors ({groupedFaqs.competitor.length})</TabsTrigger>
              <TabsTrigger value="documents">Documents ({groupedFaqs.document.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-3">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading FAQs...</div>
              ) : filteredFaqs.length > 0 ? (
                filteredFaqs.map(faq => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No FAQs found</div>
              )}
            </TabsContent>

            <TabsContent value="website" className="space-y-3">
              {filterByTab(groupedFaqs.website).length > 0 ? (
                filterByTab(groupedFaqs.website).map(faq => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No website FAQs yet</div>
              )}
            </TabsContent>

            <TabsContent value="competitors" className="space-y-3">
              {filterByTab(groupedFaqs.competitor).length > 0 ? (
                filterByTab(groupedFaqs.competitor).map(faq => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No competitor FAQs yet</div>
              )}
            </TabsContent>

            <TabsContent value="documents" className="space-y-3">
              {filterByTab(groupedFaqs.document).length > 0 ? (
                filterByTab(groupedFaqs.document).map(faq => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No document FAQs yet</div>
              )}
            </TabsContent>
          </Tabs>

          {/* Empty State */}
          {faqs.length === 0 && !loading && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No knowledge yet</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Complete onboarding to scrape your website and build your knowledge base.
                </p>
                <Button asChild>
                  <Link to="/onboarding">Go to Onboarding</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
