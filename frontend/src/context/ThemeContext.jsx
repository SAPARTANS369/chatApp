import React, { createContext, useContext, useState, useEffect } from 'react';

const themes = {
    matrix: {
        name: 'Matrix Retro',
        icon: '🖥',
        vars: {
            '--bg-dark': '#000000',
            '--bg-darker': '#000000',
            '--primary': '#00ff41',
            '--primary-hover': '#008f11',
            '--secondary': '#003b00',
            '--text-main': '#00ff41',
            '--text-muted': '#008f11',
            '--glass-bg': 'rgba(0, 20, 0, 0.85)',
            '--glass-border': '#00ff41',
            '--danger': '#ff003c',
            '--accent': '#00cc33',
            '--msg-sent-bg': 'rgba(0, 40, 0, 0.6)',
            '--msg-recv-bg': 'rgba(0, 20, 0, 0.5)',
            '--input-bg': '#000000',
            '--grid-color': 'rgba(0, 255, 65, 0.05)',
            '--shadow-primary': 'rgba(0, 255, 65, 0.4)',
            '--font-family': "'Courier New', Consolas, 'Share Tech Mono', monospace",
            '--border-radius': '0px',
            '--border-style': '1px solid var(--glass-border)',
            '--scanline-display': 'none',
            '--text-transform': 'uppercase',
            '--msg-border-sent': 'none',
            '--msg-border-recv': 'none',
            '--card-padding': '1rem'
        }
    },
    cyberpunk: {
        name: 'Cyberpunk',
        icon: '⚡',
        vars: {
            '--bg-dark': '#0a0015',
            '--bg-darker': '#07000f',
            '--primary': '#ff2d95',
            '--primary-hover': '#c4006d',
            '--secondary': '#2a003a',
            '--text-main': '#ff2d95',
            '--text-muted': '#9b0060',
            '--glass-bg': 'rgba(30, 0, 50, 0.88)',
            '--glass-border': '#ff2d95',
            '--danger': '#ff6b35',
            '--accent': '#7b2fff',
            '--msg-sent-bg': 'rgba(123, 47, 255, 0.25)',
            '--msg-recv-bg': 'rgba(255, 45, 149, 0.1)',
            '--input-bg': '#0a0015',
            '--grid-color': 'rgba(255, 45, 149, 0.05)',
            '--shadow-primary': 'rgba(255, 45, 149, 0.5)',
            '--font-family': "'Courier New', 'Rajdhani', monospace",
            '--border-radius': '0px',
            '--border-style': '1px solid var(--glass-border)',
            '--scanline-display': 'none',
            '--text-transform': 'uppercase',
            '--msg-border-sent': 'none',
            '--msg-border-recv': 'none',
            '--card-padding': '1rem'
        }
    },
    ocean: {
        name: 'Ocean Modern',
        icon: '🌊',
        vars: {
            '--bg-dark': '#0f172a',
            '--bg-darker': '#020617',
            '--primary': '#0ea5e9',
            '--primary-hover': '#0284c7',
            '--secondary': '#1e293b',
            '--text-main': '#f8fafc',
            '--text-muted': '#64748b',
            '--glass-bg': 'rgba(15, 23, 42, 0.8)',
            '--glass-border': 'rgba(255,255,255,0.08)',
            '--danger': '#ef4444',
            '--accent': '#38bdf8',
            '--msg-sent-bg': '#0ea5e9',
            '--msg-recv-bg': '#1e293b',
            '--input-bg': '#1e293b',
            '--grid-color': 'rgba(14, 165, 233, 0.02)',
            '--shadow-primary': 'rgba(14, 165, 233, 0.15)',
            '--font-family': "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            '--border-radius': '12px',
            '--border-style': '1px solid rgba(255, 255, 255, 0.08)',
            '--scanline-display': 'none',
            '--text-transform': 'none',
            '--msg-border-sent': 'none',
            '--msg-border-recv': 'none',
            '--card-padding': '12px 18px'
        }
    },
    modern: {
        name: 'Sleek Dark',
        icon: '✨',
        vars: {
            '--bg-dark': '#121214',
            '--bg-darker': '#0a0a0c',
            '--primary': '#8b5cf6',
            '--primary-hover': '#7c3aed',
            '--secondary': '#1e1e24',
            '--text-main': '#f3f4f6',
            '--text-muted': '#9ca3af',
            '--glass-bg': 'rgba(18, 18, 20, 0.75)',
            '--glass-border': 'rgba(255,255,255,0.06)',
            '--danger': '#f43f5e',
            '--accent': '#a78bfa',
            '--msg-sent-bg': '#7c3aed',
            '--msg-recv-bg': '#2a2a35',
            '--input-bg': '#1e1e24',
            '--grid-color': 'transparent',
            '--shadow-primary': 'rgba(124, 58, 237, 0.2)',
            '--font-family': "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            '--border-radius': '16px',
            '--border-style': '1px solid rgba(255, 255, 255, 0.06)',
            '--scanline-display': 'none',
            '--text-transform': 'none',
            '--msg-border-sent': 'none',
            '--msg-border-recv': 'none',
            '--card-padding': '12px 18px'
        }
    },
    girly: {
        name: 'Aesthetic Pink 🌸',
        icon: '🎀',
        vars: {
            '--bg-dark': '#fff5f7',
            '--bg-darker': '#ffebeb',
            '--primary': '#ff6b8b',
            '--primary-hover': '#e04d6f',
            '--secondary': '#ffe3e8',
            '--text-main': '#4a2830',
            '--text-muted': '#a66a78',
            '--glass-bg': 'rgba(255, 255, 255, 0.92)',
            '--glass-border': '#ffc2d1',
            '--danger': '#ff477e',
            '--accent': '#f7aef8',
            '--msg-sent-bg': '#ff6b8b',
            '--msg-recv-bg': '#fff0f3',
            '--input-bg': '#ffffff',
            '--grid-color': 'rgba(255, 107, 139, 0.03)',
            '--shadow-primary': 'rgba(255, 107, 139, 0.25)',
            '--font-family': "'Fredoka', 'Quicksand', system-ui, -apple-system, sans-serif",
            '--border-radius': '24px',
            '--border-style': '2px solid #ffc2d1',
            '--scanline-display': 'none',
            '--text-transform': 'none',
            '--msg-border-sent': 'none',
            '--msg-border-recv': 'none',
            '--card-padding': '14px 22px'
        }
    }
};

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
    const [themeId, setThemeId] = useState(() => localStorage.getItem('chat-theme') || 'matrix');

    const applyTheme = (id) => {
        const theme = themes[id];
        if (!theme) return;
        const root = document.documentElement;
        Object.entries(theme.vars).forEach(([key, val]) => {
            root.style.setProperty(key, val);
        });
        document.body.style.fontFamily = theme.vars['--font-family'];
    };

    useEffect(() => {
        applyTheme(themeId);
    }, [themeId]);

    const setTheme = (id) => {
        setThemeId(id);
        localStorage.setItem('chat-theme', id);
    };

    return (
        <ThemeContext.Provider value={{ themeId, setTheme, themes }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
export default ThemeContext;
