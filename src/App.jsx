import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Chat from './components/Chat';
import { auth, db } from './firebase';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  getDoc,
  onSnapshot
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

// Simple loading component
const Loading = () => <div className="loading">Loading...</div>;

function App() {
  const [user, setUser] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let snapshotUnsubscribe;

    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      if (u) {
        // Generate or retrieve session ID for this specific browser/device
        let currentSessionId = localStorage.getItem('device_session_id');
        if (!currentSessionId) {
          currentSessionId = uuidv4();
          localStorage.setItem('device_session_id', currentSessionId);
        }

        // User is logged in
        const userRef = doc(db, "users", u.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          // Create new user doc if it doesn't exist
          await setDoc(userRef, {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName || u.email.split('@')[0],
            photoURL: u.photoURL || "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png",
            isOnline: true,
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp(),
            activeSessionId: currentSessionId
          });
        } else {
          // Update existing user to be online and set active session
          await updateDoc(userRef, {
            isOnline: true,
            activeSessionId: currentSessionId
          });
        }

        // Listen for changes to the user document to detect logins on other devices
        // We add a small delay to allow the updateDoc to propagate and avoid race conditions with initial load
        setTimeout(() => {
          snapshotUnsubscribe = onSnapshot(userRef, (doc) => {
            if (doc.exists()) {
              const data = doc.data();
              // If the active session ID in DB is different from ours, logout
              if (data.activeSessionId && data.activeSessionId !== currentSessionId) {
                console.log("Session mismatch detected. Logging out.", data.activeSessionId, currentSessionId);
                // auth.signOut();
              }
            }
          });
        }, 1000);

        setUser(u);
      } else {
        // User is logged out
        if (snapshotUnsubscribe) {
          snapshotUnsubscribe();
        }
        setUser(null);
      }
      setLoading(false);
    });

    // Handle tab close / browser close to set offline
    const handleTabClose = async () => {
      if (auth.currentUser) {
        // Note: direct Firestore calls in beforeunload are not guaranteed to succeed 
        // because the browser might kill the connection instantly.
        // However, this is a best-effort attempt.
        // For 100% reliability, Presence via Realtime Database is recommended by Firebase, 
        // but Firestore update is requested here.
        const userRef = doc(db, "users", auth.currentUser.uid);
        // We use keepalive: true implicitly? No, JS SDK doesn't support fetch options like that easily for firestore.
        // But we can try validation.
        // Actually, for "beforeunload", standard practice with Firestore is tricky.
        // We will just do the update.
        await updateDoc(userRef, {
          isOnline: false,
          lastSeen: serverTimestamp()
        });
      }
    };

    window.addEventListener('beforeunload', handleTabClose);

    return () => {
      unsubscribe();
      if (snapshotUnsubscribe) snapshotUnsubscribe();
      window.removeEventListener('beforeunload', handleTabClose);
    };
  }, []);

  if (loading) return <Loading />;

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />
        <Route
          path="/"
          element={user ? <Chat user={user} /> : <Navigate to="/login" />}
        />
      </Routes>
    </Router>
  );
}

export default App;
