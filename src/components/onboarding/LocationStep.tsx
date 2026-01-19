import { useState } from "react";
import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Loader2, MapPin } from "lucide-react";

interface LocationStepProps {
    onNext: () => void;
    onBack: () => void;
}

export function LocationStep({ onNext, onBack }: LocationStepProps) {
    const { workspace } = useWorkspace();
    const [loading, setLoading] = useState(false);
    const [address, setAddress] = useState("");
    const [radius, setRadius] = useState([10]); // Default 10 miles/km

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!workspace?.id) return;

        setLoading(true);
        try {
            const wsRef = doc(db, "workspaces", workspace.id);
            await updateDoc(wsRef, {
                address: address,
                service_radius: radius[0],
                updated_at: new Date().toISOString(),
            });
            onNext();
        } catch (error) {
            console.error("Error saving location:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-4">
                <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3">
                    <MapPin className="text-blue-600 h-5 w-5 mt-0.5" />
                    <p className="text-sm text-blue-800">
                        Determining your location helps BizzyBee understand local context and timezones for better scheduling.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="address">Business Address</Label>
                    <Input
                        id="address"
                        placeholder="123 Main St, City, Country"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        required
                    />
                </div>

                <div className="space-y-4 pt-2">
                    <div className="flex justify-between items-center">
                        <Label htmlFor="radius">Service Radius</Label>
                        <span className="text-sm font-medium text-muted-foreground">{radius[0]} miles</span>
                    </div>
                    <Slider
                        id="radius"
                        value={radius}
                        onValueChange={setRadius}
                        max={100}
                        step={1}
                        min={1}
                    />
                    <p className="text-xs text-muted-foreground">
                        How far do you travel to serve customers? (Approximate)
                    </p>
                </div>
            </div>

            <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={onBack} disabled={loading} className="w-1/3">
                    Back
                </Button>
                <Button type="submit" className="w-2/3" size="lg" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Continue
                </Button>
            </div>
        </form>
    );
}
