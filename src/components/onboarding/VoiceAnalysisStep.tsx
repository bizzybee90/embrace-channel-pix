import { useState } from "react";
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from "@/components/ui/button";
import { functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { Loader2, BrainCircuit, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface VoiceAnalysisStepProps {
    onNext: () => void;
    onBack: () => void;
}

export function VoiceAnalysisStep({ onNext, onBack }: VoiceAnalysisStepProps) {
    const { workspace } = useWorkspace();
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("Ready to learn");

    const startLearning = async () => {
        if (!workspace?.id) return;

        setLoading(true);
        setStatus("Initializing Intelligence Engine...");
        setProgress(10);

        try {
            // Simulate progress for UX while waiting for function
            const interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev >= 90) return prev;
                    return prev + 5;
                });
            }, 500);

            const learnVoice = httpsCallable(functions, 'learnVoice');
            await learnVoice({ workspaceId: workspace.id });

            clearInterval(interval);
            setProgress(100);
            setStatus("Voice analysis complete!");

            // Delay slightly to show success
            setTimeout(() => {
                onNext();
            }, 1000);

        } catch (error) {
            console.error("Error learning voice:", error);
            setStatus("Error fetching emails. Please try again.");
            setLoading(false);
            setProgress(0);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-4 py-8">
                <div className="mx-auto w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center relative">
                    <BrainCircuit className="w-8 h-8 text-purple-600" />
                    {loading && (
                        <div className="absolute inset-0 rounded-full border-4 border-purple-400 border-t-transparent animate-spin" />
                    )}
                </div>
                <h3 className="text-xl font-semibold">Train your AI Agent</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                    BizzyBee will analyze your past emails to understand your tone, common replies, and business policies.
                </p>
            </div>

            {loading && (
                <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium text-muted-foreground">
                        <span>{status}</span>
                        <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                </div>
            )}

            <div className="bg-purple-50 p-4 rounded-lg flex gap-3 text-sm text-purple-900">
                <Sparkles className="h-5 w-5 text-purple-600 mt-0.5" />
                <p>
                    This process happens in the background. We fetch the last 50 sent emails to build your unique voice profile.
                </p>
            </div>

            <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={onBack} disabled={loading} className="w-1/3">
                    Back
                </Button>
                <Button onClick={startLearning} className="w-2/3 bg-purple-600 hover:bg-purple-700" size="lg" disabled={loading}>
                    {loading ? "Analyzing..." : "Start Learning"}
                </Button>
            </div>
        </div>
    );
}
