import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';
import { 
    generateECDHKeyPair, 
    encryptPrivateKey, 
    decryptPrivateKey 
} from '../utils/cryptoUtils';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                const storedPrivateKey = sessionStorage.getItem('ecdh_private_key');
                setUser({ 
                    id: payload.userId, 
                    username: payload.username,
                    ecdhPrivateKey: storedPrivateKey 
                });
            } catch (e) {
                localStorage.removeItem('token');
                sessionStorage.removeItem('ecdh_private_key');
                setToken(null);
                setUser(null);
            }
        }
        setLoading(false);
    }, [token]);

    const login = async (username, password) => {
        const res = await axios.post(`${BASE_URL}/api/auth/login`, { username, password });
        localStorage.setItem('token', res.data.token);
        setToken(res.data.token);
        
        let privateKey = null;
        if (res.data.user.encryptedPrivateKey) {
            try {
                privateKey = await decryptPrivateKey(res.data.user.encryptedPrivateKey, password);
                sessionStorage.setItem('ecdh_private_key', privateKey);
            } catch (e) {
                console.error('Failed to decrypt private key:', e);
            }
        }
        
        setUser({
            id: res.data.user.id,
            username: res.data.user.username,
            displayName: res.data.user.displayName,
            avatar: res.data.user.avatar,
            ecdhPrivateKey: privateKey
        });
    };

    const register = async (username, email, password, display_name) => {
        const { publicKeyPem, privateKeyPem } = await generateECDHKeyPair();
        const encryptedPrivateKey = await encryptPrivateKey(privateKeyPem, password);

        await axios.post(`${BASE_URL}/api/auth/register`, { 
            username, 
            email, 
            password, 
            display_name,
            ecdh_public_key: publicKeyPem,
            encrypted_private_key: encryptedPrivateKey
        });
    };

    const logout = () => {
        localStorage.removeItem('token');
        sessionStorage.removeItem('ecdh_private_key');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};
