import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    User,
    onAuthStateChanged,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface UserProfile {
    id: string;
    workspace_id?: string;
    role?: string;
    onboarding_step?: number;
    [key: string]: any;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (!mounted) return;

            // Reset loading state on auth change to prevent UI flash
            // logic: if currentUser is null, we are done fast. 
            // If currentUser exists, we need to fetch profile, so keep loading true until done.
            if (!currentUser) {
                setUser(null);
                setProfile(null);
                setLoading(false);
                return;
            }

            setUser(currentUser);
            // Ensure loading is true while we fetch profile
            setLoading(true);

            try {
                const userRef = doc(db, 'users', currentUser.uid);
                const userSnap = await getDoc(userRef);

                if (userSnap.exists()) {
                    if (mounted) {
                        setProfile({ id: currentUser.uid, ...userSnap.data() } as UserProfile);
                    }
                } else {
                    // Auto-create profile for new users
                    // We use the email prefix as a fallback name if displayName is missing
                    const emailName = currentUser.email?.split('@')[0] || 'User';
                    const newProfile = {
                        email: currentUser.email,
                        name: currentUser.displayName || emailName,
                        created_at: serverTimestamp(),
                        onboarding_step: 0,
                        role: 'owner', // Default role for first user? Or just 'user'
                    };

                    await setDoc(userRef, newProfile);

                    if (mounted) {
                        setProfile({ id: currentUser.uid, ...newProfile });
                    }
                }
            } catch (error) {
                console.error("Error fetching/creating user profile:", error);
                // In production, maybe show a toast?
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    };

    const signInWithEmail = async (email: string, password: string) => {
        await signInWithEmailAndPassword(auth, email, password);
    };

    const signUpWithEmail = async (email: string, password: string) => {
        await createUserWithEmailAndPassword(auth, email, password);
    };

    const signOut = async () => {
        await firebaseSignOut(auth);
        setProfile(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
