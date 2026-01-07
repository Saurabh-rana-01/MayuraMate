import React, { useState } from 'react';
import {
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useNavigate } from 'react-router-dom';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // Auth state listener in App.jsx will handle navigation/state update
        } catch (err) {
            setError(err.message);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            // Update user profile with display name
            await updateProfile(userCredential.user, {
                displayName: username
            });
            // Auth state listener will handle the rest
        } catch (err) {
            setError(err.message);
        }
    };

    const handleGoogleLogin = async () => {
        setError('');
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h2>{isRegistering ? 'Create Account' : 'Welcome Back'}</h2>
                <p style={{ color: '#54656f', marginBottom: '20px' }}>
                    {isRegistering ? 'Sign up to get started' : 'Sign in to your account'}
                </p>

                {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}

                <form className="auth-form" onSubmit={isRegistering ? handleRegister : handleLogin}>
                    {isRegistering && (
                        <input
                            type="text"
                            placeholder="Username"
                            className="auth-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    )}
                    <input
                        type="email"
                        placeholder="Email address"
                        className="auth-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        className="auth-input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />

                    <button type="submit" className="login-btn">
                        {isRegistering ? 'Sign Up' : 'Login'}
                    </button>
                </form>

                <button onClick={handleGoogleLogin} className="login-btn google-btn">
                    <img
                        src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                        alt="Google"
                        style={{ width: '18px', height: '18px' }}
                    />
                    Sign in with Google
                </button>

                <div
                    className="toggle-auth"
                    onClick={() => setIsRegistering(!isRegistering)}
                >
                    {isRegistering
                        ? 'Already have an account? Login'
                        : "Don't have an account? Sign Up"}
                </div>
            </div>
        </div>
    );
};

export default Login;
