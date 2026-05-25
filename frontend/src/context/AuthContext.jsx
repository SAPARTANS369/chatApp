import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) {
            // In a real app, verify token with backend
            // Here we just decode it simply or assume valid if exists
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                setUser({ id: payload.userId, username: payload.username });
            } catch (e) {
                localStorage.removeItem('token');
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
        setUser(res.data.user);
    };

    const register = async (username, email, password, display_name) => {
        await axios.post(`${BASE_URL}/api/auth/register`, { username, email, password, display_name });
    };

    const logout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};
