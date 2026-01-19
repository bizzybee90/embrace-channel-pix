import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface AISettings {
    auto_send_enabled: boolean;
    auto_send_threshold: number;
    default_to_drafts: boolean;
    always_verify: boolean;
    notify_on_low_confidence: boolean;
    low_confidence_threshold: number;
    [key: string]: any;
}

const DEFAULT_SETTINGS: AISettings = {
    auto_send_enabled: false,
    auto_send_threshold: 0.95,
    default_to_drafts: true,
    always_verify: true,
    notify_on_low_confidence: true,
    low_confidence_threshold: 0.7,
};

export const useSettings = () => {
    const { user, profile } = useAuth();
    const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // We assume the workspace_id comes from the user profile
    const workspaceId = profile?.workspace_id;

    useEffect(() => {
        if (!workspaceId) return;

        setLoading(true);
        // Path: workspaces/{id}/settings/ai
        const settingsRef = doc(db, 'workspaces', workspaceId, 'settings', 'ai');

        const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) {
                setSettings({ ...DEFAULT_SETTINGS, ...docSnap.data() } as AISettings);
            } else {
                // If it doesn't exist, we fallback to default but don't write yet
                setSettings(DEFAULT_SETTINGS);
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching settings:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [workspaceId]);

    const updateSetting = async (key: string, value: any) => {
        if (!workspaceId) return;

        setSaving(true);
        // Optimistic update
        setSettings((prev) => ({ ...prev, [key]: value }));

        try {
            const settingsRef = doc(db, 'workspaces', workspaceId, 'settings', 'ai');
            // setDoc with merge: true handles both update and create if missing
            await setDoc(settingsRef, { [key]: value }, { merge: true });
        } catch (error) {
            console.error('Error updating setting:', error);
            // Revert optimism? For now, we trust Firebase eventual consistency or error handling
        } finally {
            setSaving(false);
        }
    };

    return {
        settings,
        loading,
        saving,
        updateSetting,
        workspaceId
    };
};
