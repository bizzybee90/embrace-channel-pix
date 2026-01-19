import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Loader2 } from "lucide-react";

interface BusinessProfileStepProps {
    onNext: () => void;
}

export function BusinessProfileStep({ onNext }: BusinessProfileStepProps) {
    const { user } = useAuth();
    const { workspace } = useWorkspace(); // Assuming we have a workspace created or placeholder
    const [loading, setLoading] = useState(false);

    // Local state for form
    const [formData, setFormData] = useState({
        business_name: "",
        industry: "",
        website: "",
    });

    useEffect(() => {
        if (workspace) {
            setFormData({
                business_name: workspace.name || "",
                industry: (workspace as any).industry || "",
                website: (workspace as any).website || "",
            });
        }
    }, [workspace]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!workspace?.id) return;

        setLoading(true);
        try {
            const wsRef = doc(db, "workspaces", workspace.id);
            await updateDoc(wsRef, {
                name: formData.business_name,
                industry: formData.industry,
                website: formData.website,
                updated_at: new Date().toISOString(),
            });
            onNext();
        } catch (error) {
            console.error("Error saving business profile:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="business_name">Business Name</Label>
                    <Input
                        id="business_name"
                        placeholder="e.g. Acme Corp"
                        value={formData.business_name}
                        onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Input
                        id="industry"
                        placeholder="e.g. Retail, Healthcare, Tech"
                        value={formData.industry}
                        onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="website">Website (Optional)</Label>
                    <Input
                        id="website"
                        placeholder="https://example.com"
                        value={formData.website}
                        onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    />
                </div>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
            </Button>
        </form>
    );
}
