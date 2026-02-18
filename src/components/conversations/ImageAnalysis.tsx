import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Image, Loader2, Wand2, Copy, Check } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ImageAnalysisProps {
  workspaceId: string;
  messageId?: string;
  imageUrl: string;
  customerMessage?: string;
  onSuggestedResponse?: (response: string) => void;
}

interface AnalysisResult {
  description?: string;
  job_description?: string;
  damage_type?: string;
  vendor?: string;
  suggested_response?: string;
  confidence?: number;
  scope?: {
    size_estimate?: string;
    complexity?: string;
    estimated_duration?: string;
  };
  severity?: string;
  items?: Array<{ description: string; quantity?: number; amount?: number }>;
  total?: number;
  [key: string]: unknown;
}

export const ImageAnalysis = ({ 
  workspaceId, 
  messageId, 
  imageUrl,
  customerMessage,
  onSuggestedResponse 
}: ImageAnalysisProps) => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysisType, setAnalysisType] = useState<'quote' | 'damage' | 'receipt' | 'general'>('general');
  const [copied, setCopied] = useState(false);

  const analyzeImage = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('image-analyze', {
        body: {
          workspace_id: workspaceId,
          message_id: messageId,
          image_url: imageUrl,
          analysis_type: analysisType,
          customer_message: customerMessage
        }
      });

      if (error) throw error;
      setAnalysis(data.result);

      if (data.result?.suggested_response) {
        toast.success('Image analyzed! Response suggestion ready.');
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to analyze image';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const useSuggestion = () => {
    if (analysis?.suggested_response && onSuggestedResponse) {
      onSuggestedResponse(analysis.suggested_response);
      toast.success('Response added to draft');
    }
  };

  const copyToClipboard = async () => {
    if (analysis?.suggested_response) {
      await navigator.clipboard.writeText(analysis.suggested_response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getMainDescription = () => {
    if (analysis?.description) return analysis.description;
    if (analysis?.job_description) return analysis.job_description;
    if (analysis?.damage_type) return `Damage detected: ${analysis.damage_type}`;
    if (analysis?.vendor) return `Receipt from: ${analysis.vendor}`;
    return 'Analysis complete';
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Image className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Image Attachment</span>
          </div>
          
          {!analysis && (
            <div className="flex items-center gap-2">
              <Select 
                value={analysisType} 
                onValueChange={(v) => setAnalysisType(v as typeof analysisType)}
              >
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="quote">Quote</SelectItem>
                  <SelectItem value="damage">Damage</SelectItem>
                  <SelectItem value="receipt">Receipt</SelectItem>
                </SelectContent>
              </Select>
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={analyzeImage}
                disabled={loading}
                className="h-8"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3 mr-1" />
                )}
                Analyze
              </Button>
            </div>
          )}
        </div>

        <img 
          src={imageUrl} 
          alt="Attachment" 
          className="w-full max-h-48 object-cover rounded-md mb-3"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />

        {analysis && (
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-foreground flex-1">
                {getMainDescription()}
              </p>
              {analysis.confidence && (
                <Badge 
                  variant={analysis.confidence > 0.7 ? 'default' : 'secondary'}
                  className="shrink-0"
                >
                  {Math.round(analysis.confidence * 100)}%
                </Badge>
              )}
            </div>

            {/* Show scope for quote analysis */}
            {analysis.scope && (
              <div className="text-xs text-muted-foreground space-y-1">
                {analysis.scope.size_estimate && (
                  <p><span className="font-medium">Size:</span> {analysis.scope.size_estimate}</p>
                )}
                {analysis.scope.complexity && (
                  <p><span className="font-medium">Complexity:</span> {analysis.scope.complexity}</p>
                )}
                {analysis.scope.estimated_duration && (
                  <p><span className="font-medium">Duration:</span> {analysis.scope.estimated_duration}</p>
                )}
              </div>
            )}

            {/* Show severity for damage analysis */}
            {analysis.severity && (
              <Badge 
                variant={analysis.severity === 'severe' || analysis.severity === 'critical' ? 'destructive' : 'secondary'}
              >
                Severity: {analysis.severity}
              </Badge>
            )}

            {/* Show items for receipt analysis */}
            {analysis.items && analysis.items.length > 0 && (
              <div className="text-xs space-y-1">
                {analysis.items.slice(0, 3).map((item, i) => (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span>{item.description}</span>
                    {item.amount && <span>${item.amount.toFixed(2)}</span>}
                  </div>
                ))}
                {analysis.total && (
                  <div className="flex justify-between font-medium pt-1 border-t">
                    <span>Total</span>
                    <span>${analysis.total.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {analysis.suggested_response && (
              <div className="flex gap-2 pt-2">
                {onSuggestedResponse && (
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={useSuggestion}
                    className="flex-1"
                  >
                    Use Suggestion
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
