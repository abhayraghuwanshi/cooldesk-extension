// firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously,
  signInWithCredential
} from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc
} from "firebase/firestore";

// Feature flag: disable authentication in this build for a cleaner manifest
export const AUTH_DISABLED = true;

// ------------------
// Firebase Config
// ------------------
const firebaseConfig = {
  apiKey: "AIzaSyAoazHeLDGCFDXBQ0jE_LILgyzENYWl3Hw",
  authDomain: "cooldesk-896b9.firebaseapp.com",
  projectId: "cooldesk-896b9",
  messagingSenderId: "256165123494",
  appId: "1:256165123494:web:f8be723e74a5e4c3756b67",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Set persistence for auth state (skip when disabled)
if (!AUTH_DISABLED) {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("Could not enable auth persistence:", error);
  });
}

let currentUser = null;

// Read OAuth client configuration from the extension manifest (MV3) or env
const manifest = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) ? chrome.runtime.getManifest() : null;
const OAUTH_CLIENT_ID = manifest?.oauth2?.client_id || (typeof process !== 'undefined' ? process.env.EXT_OAUTH_CLIENT_ID : undefined);
const OAUTH_SCOPES = manifest?.oauth2?.scopes || ["profile", "email", "openid"];

// ------------------
// Auth Setup
// ------------------
const AUTH_STATE_KEY = 'firebase_auth_state';

export const initAuth = () => {
  if (AUTH_DISABLED) {
    currentUser = null;
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    // Wait for auth state to be restored from persistence
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        console.log("Auth state restored:", user.uid, user.isAnonymous ? "(anonymous)" : "(signed in)");
        unsubscribe(); // Stop listening after first auth state
        resolve(user);
      } else {
        currentUser = null;
        
        // Check if user has explicitly signed out
        const authState = localStorage.getItem(AUTH_STATE_KEY);
        if (authState === 'signed_out') {
          console.log("No user signed in (user signed out)");
          unsubscribe();
          resolve(null);
          return;
        }
        
        // Only auto-create anonymous user if never tried before
        if (!authState || authState === 'anonymous_created') {
          try {
            localStorage.setItem(AUTH_STATE_KEY, 'anonymous_created');
            const result = await signInAnonymously(auth);
            currentUser = result.user;
            console.log("Signed in anonymously:", currentUser.uid);
            unsubscribe();
            resolve(result.user);
          } catch (error) {
            console.error("Failed to create anonymous user:", error);
            unsubscribe();
            resolve(null);
          }
        } else {
          console.log("No user signed in");
          unsubscribe();
          resolve(null);
        }
      }
    });
    
    // Set up persistent auth state listener after initial restore
    setTimeout(() => {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          currentUser = user;
          console.log("Auth state changed:", user.uid, user.isAnonymous ? "(anonymous)" : "(signed in)");
        } else {
          currentUser = null;
          console.log("User signed out");
        }
      });
    }, 1000);
  });
};

// ------------------
// Google Sign-In (Cross-browser Extension Support)
// ------------------
export const signInWithGoogle = async () => {
  if (AUTH_DISABLED) {
    return { success: false, error: 'Authentication is disabled in this build.' };
  }
  try {
    // Chrome Extension Identity API
    if (typeof chrome !== "undefined" && chrome.identity?.getAuthToken) {
      try {
        // identity.getAuthToken relies on manifest.oauth2 client_id + scopes
        if (!manifest?.oauth2?.client_id) {
          throw new Error("Missing oauth2.client_id in manifest.json. Configure OAuth client for chrome.identity.");
        }
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(token);
            }
          });
        });

        if (token) {
          const credential = GoogleAuthProvider.credential(null, token);
          const result = await signInWithCredential(auth, credential);
          currentUser = result.user;
          // Clear signed out state on successful sign-in
          localStorage.removeItem(AUTH_STATE_KEY);
          console.log("Signed in with Google (Chrome):", currentUser.uid);
          return { success: true, user: currentUser };
        }
      } catch (chromeError) {
        console.warn("Chrome Identity API failed:", chromeError.message);
      }
    }

    // Fallback: Extension popup window approach for non-Chrome or when getAuthToken fails
    if (!OAUTH_CLIENT_ID) {
      return { success: false, error: 'OAuth client ID not configured. Add oauth2.client_id in manifest.json or EXT_OAUTH_CLIENT_ID env.' };
    }
    const authUrl = `https://accounts.google.com/oauth/v2/auth?` +
      `client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}&` +
      `response_type=token&` +
      `scope=${encodeURIComponent(OAUTH_SCOPES.join(' '))}&` +
      `redirect_uri=${encodeURIComponent(chrome.identity.getRedirectURL())}`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, async (responseUrl) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        try {
          // Extract access token from URL
          const urlParams = new URL(responseUrl).hash.substring(1);
          const params = new URLSearchParams(urlParams);
          const accessToken = params.get('access_token');

          if (!accessToken) {
            throw new Error('No access token received');
          }

          const credential = GoogleAuthProvider.credential(null, accessToken);
          const result = await signInWithCredential(auth, credential);
          currentUser = result.user;
          // Clear signed out state on successful sign-in
          localStorage.removeItem(AUTH_STATE_KEY);
          console.log("Signed in with Google (fallback):", currentUser.uid);
          resolve({ success: true, user: currentUser });

        } catch (error) {
          console.error("Fallback auth error:", error);
          resolve({ success: false, error: error.message });
        }
      });
    });

  } catch (error) {
    console.error("Google sign-in error:", error);
    return { success: false, error: error.message };
  }
};

// ------------------
// Upgrade Anonymous Account to Google
// ------------------
export const upgradeAnonymousWithGoogle = async () => {
  if (AUTH_DISABLED) {
    return { success: false, error: 'Authentication is disabled in this build.' };
  }
  try {
    if (!auth.currentUser?.isAnonymous) {
      return { success: false, error: "Current user is not anonymous" };
    }

    // Try Chrome Identity API first
    if (typeof chrome !== "undefined" && chrome.identity?.getAuthToken) {
      try {
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(token);
            }
          });
        });

        if (token) {
          const credential = GoogleAuthProvider.credential(null, token);
          const linked = await linkWithCredential(auth.currentUser, credential);
          currentUser = linked.user;
          // Clear signed out state on successful upgrade
          localStorage.removeItem(AUTH_STATE_KEY);
          console.log("Anonymous account upgraded to Google (Chrome):", currentUser.uid);
          return { success: true, user: currentUser };
        }
      } catch (chromeError) {
        console.warn("Chrome Identity API failed for upgrade:", chromeError.message);
      }
    }

    // Fallback for Edge/other browsers
    if (!OAUTH_CLIENT_ID) {
      return { success: false, error: 'OAuth client ID not configured. Add oauth2.client_id in manifest.json or EXT_OAUTH_CLIENT_ID env.' };
    }
    const authUrl = `https://accounts.google.com/oauth/v2/auth?` +
      `client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}&` +
      `response_type=token&` +
      `scope=${encodeURIComponent(OAUTH_SCOPES.join(' '))}&` +
      `redirect_uri=${encodeURIComponent(chrome.identity.getRedirectURL())}`;

    return new Promise((resolve) => {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, async (responseUrl) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        try {
          const urlParams = new URL(responseUrl).hash.substring(1);
          const params = new URLSearchParams(urlParams);
          const accessToken = params.get('access_token');

          if (!accessToken) {
            throw new Error('No access token received');
          }

          const credential = GoogleAuthProvider.credential(null, accessToken);
          const linked = await linkWithCredential(auth.currentUser, credential);
          currentUser = linked.user;
          // Clear signed out state on successful upgrade
          localStorage.removeItem(AUTH_STATE_KEY);
          console.log("Anonymous account upgraded to Google (fallback):", currentUser.uid);
          resolve({ success: true, user: currentUser });

        } catch (error) {
          console.error("Upgrade fallback error:", error);
          resolve({ success: false, error: error.message });
        }
      });
    });

  } catch (error) {
    console.error("Upgrade anonymous error:", error);
    return { success: false, error: error.message };
  }
};

// ------------------
// Firestore Helpers
// ------------------
export const addWorkspace = async (workspaceId, data) => {
  if (!currentUser || currentUser.isAnonymous) {
    console.log("Firestore add not available for anonymous users");
    return false;
  }
  
  try {
    const docRef = doc(db, "users", currentUser.uid, "workspaces", workspaceId);
    await setDoc(docRef, data, { merge: true });
    return true;
  } catch (error) {
    console.error("Error adding workspace to Firestore:", error);
    return false;
  }
};

export const getWorkspace = async (workspaceId) => {
  if (!currentUser || currentUser.isAnonymous) {
    console.log("Firestore get not available for anonymous users");
    return null;
  }
  
  try {
    const docRef = doc(db, "users", currentUser.uid, "workspaces", workspaceId);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.error("Error getting workspace from Firestore:", error);
    return null;
  }
};

// ------------------
// Current User Getter
// ------------------
export const getCurrentUser = () => currentUser;

// ------------------
// Manual Anonymous Sign-In
// ------------------
export const createAnonymousUser = async () => {
  try {
    const result = await signInAnonymously(auth);
    currentUser = result.user;
    console.log("Created anonymous user:", currentUser.uid);
    return { success: true, user: currentUser };
  } catch (error) {
    console.error("Anonymous sign-in error:", error);
    return { success: false, error: error.message };
  }
};

// ------------------
// Additional Firebase Functions
// ------------------
export const initializeFirebase = async () => {
  try {
    if (AUTH_DISABLED) return false;
    await initAuth();
    return true;
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    return false;
  }
};

export const onAuthStateChange = (callback) => {
  if (AUTH_DISABLED) {
    // return a no-op unsubscribe
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
};

export const signOutUser = async () => {
  try {
    if (AUTH_DISABLED) {
      currentUser = null;
      return { success: true };
    }
    // Mark that user explicitly signed out
    localStorage.setItem(AUTH_STATE_KEY, 'signed_out');
    await auth.signOut();
    currentUser = null;
    console.log("User signed out");
    return { success: true };
  } catch (error) {
    console.error("Sign out error:", error);
    return { success: false, error: error.message };
  }
};

export const listWorkspaces = async () => {
  // Only allow for authenticated Google users, not anonymous users
  if (!currentUser || currentUser.isAnonymous) {
    console.log("Firestore operations not available for anonymous users");
    return [];
  }
  
  try {
    const { getDocs, collection } = await import("firebase/firestore");
    const workspacesRef = collection(db, "users", currentUser.uid, "workspaces");
    const snapshot = await getDocs(workspacesRef);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error listing workspaces from Firestore:", error);
    console.warn("Firestore may not be properly configured or user lacks permissions");
    return [];
  }
};

export const deleteWorkspaceById = async (workspaceId) => {
  if (!currentUser || currentUser.isAnonymous) {
    console.log("Firestore delete not available for anonymous users");
    return { success: false, error: "Authentication required" };
  }
  
  try {
    const { deleteDoc } = await import("firebase/firestore");
    const docRef = doc(db, "users", currentUser.uid, "workspaces", workspaceId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    console.error("Error deleting workspace from Firestore:", error);
    return { success: false, error: error.message };
  }
};

export const subscribeWorkspaceChanges = async (callback) => {
  // Only allow for authenticated Google users, not anonymous users
  if (!currentUser || currentUser.isAnonymous) {
    console.log("Firestore subscriptions not available for anonymous users");
    return () => {};
  }
  
  try {
    const { onSnapshot, collection } = await import("firebase/firestore");
    const workspacesRef = collection(db, "users", currentUser.uid, "workspaces");
    return onSnapshot(workspacesRef, callback, (error) => {
      console.error("Firestore listener error:", error);
      console.warn("Firestore subscription failed - check project configuration");
    });
  } catch (error) {
    console.error("Error subscribing to workspace changes:", error);
    return () => {};
  }
};
