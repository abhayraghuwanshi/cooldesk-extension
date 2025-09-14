import React, { createContext, useEffect, useState } from "react";
import { getCurrentUser, onAuthStateChange, signInWithGoogle, signOutUser } from "../services/firebase";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(false);

    const handleGoogleSignIn = async () => {
        try {
            setAuthLoading(true);
            const result = await signInWithGoogle();
            if (!result.success) {
                alert("Sign-in failed: " + result.error);
            }
        } catch (error) {
            console.error("Google sign-in failed", error);
            alert("Sign-in failed: " + error.message);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleSignOut = async () => {
        try {
            setAuthLoading(true);
            const result = await signOutUser();
            if (!result.success) {
                console.error("Sign out failed", result.error);
            }
        } catch (error) {
            console.error("Sign out failed", error);
        } finally {
            setAuthLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChange((user) => setCurrentUser(user));
        return () => unsubscribe();
    }, []);

    return (
        <AuthContext.Provider value={{ currentUser, authLoading, handleGoogleSignIn, handleSignOut }}>
            {children}
        </AuthContext.Provider>
    );
};
