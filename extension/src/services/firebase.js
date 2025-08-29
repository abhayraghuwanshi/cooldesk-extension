import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signOut, onAuthStateChanged, signInWithPopup, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, orderBy, query, updateDoc, connectFirestoreEmulator, enableNetwork, disableNetwork } from 'firebase/firestore';

// Firebase configuration - you'll need to replace with your project's config
const firebaseConfig = {
  apiKey: "AIzaSyAoazHeLDGCFDXBQ0jE_LILgyzENYWl3Hw",
  authDomain: "cooldesk-896b9.firebaseapp.com",
  projectId: "cooldesk-896b9",
  messagingSenderId: "256165123494",
  appId: "1:256165123494:web:f8be723e74a5e4c3756b67",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Configure Firestore for better extension compatibility
try {
  // Suppress WebChannel connection warnings in development
  if (process.env.NODE_ENV === 'development') {
    console.log('Firestore: Running in development mode');
  }
  
  // Add connection state monitoring
  let isConnected = true;
  
  // Handle connection errors gracefully
  const handleConnectionError = (error) => {
    console.warn('Firestore connection issue (this is usually non-critical):', error.message);
    isConnected = false;
    
    // Try to reconnect after a delay
    setTimeout(async () => {
      try {
        await enableNetwork(db);
        isConnected = true;
        console.log('Firestore: Connection restored');
      } catch (reconnectError) {
        console.warn('Firestore: Reconnection failed', reconnectError);
      }
    }, 5000);
  };
  
  // Global error handler for Firestore
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && event.reason.message.includes('WebChannelConnection')) {
      handleConnectionError(event.reason);
      event.preventDefault(); // Prevent the error from being logged to console
    }
  });
  
} catch (error) {
  console.warn('Failed to configure Firestore connection handling:', error);
}

// Anonymous authentication for user session
let currentUser = null;

export const initializeFirebase = async () => {
  try {
    const userCredential = await signInAnonymously(auth);
    currentUser = userCredential.user;
    console.log('Firebase initialized with user:', currentUser.uid);
    return true;
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    
    // Provide specific error messages
    if (error.code === 'auth/admin-restricted-operation') {
      console.error('Anonymous authentication is disabled. Please enable it in Firebase Console > Authentication > Sign-in method');
      throw new Error('Anonymous authentication is not enabled. Please enable it in Firebase Console.');
    } else if (error.code === 'auth/operation-not-allowed') {
      console.error('Anonymous authentication is not allowed for this project');
      throw new Error('Anonymous authentication is not allowed for this project.');
    } else if (error.code === 'auth/network-request-failed') {
      console.error('Network error - check your internet connection');
      throw new Error('Network error. Please check your internet connection.');
    }
    
    throw error; // Re-throw other errors
  }
};

// Authentication functions
export const signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    
    // Check if we're in an extension environment and use Chrome Identity API if available
    if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken) {
      try {
        // Use Chrome Identity API for extensions
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
          // Sign in to Firebase with the token
          const credential = GoogleAuthProvider.credential(null, token);
          const result = await signInWithCredential(auth, credential);
          currentUser = result.user;
          return { success: true, user: currentUser };
        }
      } catch (identityError) {
        console.log('Chrome Identity API failed, falling back to popup:', identityError);
      }
    }
    
    // Fallback to popup method
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    return { success: true, user: currentUser };
    
  } catch (error) {
    console.error('Google sign-in error:', error);
    
    // Provide specific error messages
    if (error.code === 'auth/popup-blocked') {
      return { success: false, error: 'Popup was blocked. Please allow popups for this extension.' };
    } else if (error.code === 'auth/popup-closed-by-user') {
      return { success: false, error: 'Sign-in was cancelled.' };
    } else if (error.code === 'auth/operation-not-allowed') {
      return { success: false, error: 'Google Sign-In is not enabled. Please enable it in Firebase Console.' };
    }
    
    return { success: false, error: error.message };
  }
};

export const signOutUser = async () => {
  try {
    await signOut(auth);
    currentUser = null;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const getCurrentUser = () => currentUser;

export const onAuthStateChange = (callback) => {
  return onAuthStateChanged(auth, (user) => {
    currentUser = user;
    callback(user);
  });
};

// Get user-specific collection path
const getUserCollection = (collectionName) => {
  if (!currentUser) throw new Error('User not authenticated');
  return `users/${currentUser.uid}/${collectionName}`;
};

// Workspaces operations
export const saveWorkspace = async (workspace) => {
  try {
    const workspacesRef = collection(db, getUserCollection('workspaces'));
    if (workspace.id) {
      // Update existing
      const docRef = doc(db, getUserCollection('workspaces'), workspace.id);
      await updateDoc(docRef, {
        ...workspace,
        updatedAt: Date.now()
      });
    } else {
      // Create new
      const docRef = await addDoc(workspacesRef, {
        ...workspace,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      workspace.id = docRef.id;
    }
    return workspace;
  } catch (error) {
    // Handle WebChannel and connection errors gracefully
    if (error.message && error.message.includes('WebChannelConnection')) {
      console.warn('Firestore write connection issue (retrying...):', error.message);
      
      // Retry the operation once after a short delay
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await saveWorkspace(workspace); // Retry once
      } catch (retryError) {
        console.error('Retry failed for workspace save:', retryError);
        throw new Error('Failed to save workspace due to connection issues. Please try again.');
      }
    }
    
    console.error('Error saving workspace:', error);
    throw error;
  }
};

export const listWorkspaces = async () => {
  try {
    const workspacesRef = collection(db, getUserCollection('workspaces'));
    const q = query(workspacesRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error listing workspaces:', error);
    return [];
  }
};

export const deleteWorkspaceById = async (id) => {
  try {
    const docRef = doc(db, getUserCollection('workspaces'), id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting workspace:', error);
    throw error;
  }
};

export const subscribeWorkspaceChanges = (callback) => {
  try {
    const workspacesRef = collection(db, getUserCollection('workspaces'));
    const q = query(workspacesRef, orderBy('createdAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
      callback();
    }, (error) => {
      // Handle WebChannel and connection errors gracefully
      if (error.message && (error.message.includes('WebChannelConnection') || error.message.includes('Failed to get document'))) {
        console.warn('Firestore subscription connection issue (non-critical):', error.message);
        
        // Try to re-establish subscription after a delay
        setTimeout(() => {
          try {
            subscribeWorkspaceChanges(callback);
          } catch (retryError) {
            console.warn('Failed to re-establish Firestore subscription:', retryError);
          }
        }, 10000);
      } else {
        console.error('Error in workspace subscription:', error);
      }
    });
  } catch (error) {
    console.error('Error subscribing to workspace changes:', error);
    return () => { }; // Return empty unsubscribe function
  }
};

// Settings operations
export const saveSettings = async (settings) => {
  try {
    const settingsRef = doc(db, getUserCollection('settings'), 'user-settings');
    await updateDoc(settingsRef, {
      ...settings,
      updatedAt: Date.now()
    }).catch(async (error) => {
      // If document doesn't exist, create it
      if (error.code === 'not-found') {
        await addDoc(collection(db, getUserCollection('settings')), {
          ...settings,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      } else {
        throw error;
      }
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
};

export const getSettings = async () => {
  try {
    const settingsRef = collection(db, getUserCollection('settings'));
    const querySnapshot = await getDocs(settingsRef);

    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting settings:', error);
    return null;
  }
};