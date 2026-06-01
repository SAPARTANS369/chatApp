import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useToast } from '../components/Toast';
import UserProfileModal from '../components/UserProfileModal';
import { useTheme } from '../context/ThemeContext';
import VoiceRecorder from '../components/VoiceRecorder';
import { 
    deriveECDHSharedKey, 
    encryptData, 
    decryptData, 
    encryptAESKeyWithECDH, 
    decryptAESKeyWithECDH,
    base64ToArrayBuffer,
    arrayBufferToBase64
} from '../utils/cryptoUtils';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const getFullUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${BASE_URL}${url}`;
};

const btnStyle = { background: 'transparent', color: 'var(--primary)', border: 'var(--border-style)', borderRadius: 'var(--border-radius)', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', marginLeft: '4px', textTransform: 'var(--text-transform)' };
const subHeaderStyle = { padding: '0 0.5rem 0.5rem 0.5rem', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.85rem', marginBottom: '0.5rem' };

// Reusable avatar component
const Avatar = ({ user, size = 48, onClick }) => {
    const avatarStyle = {
        width: size,
        height: size,
        fontSize: `${size * 0.4}px`,
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 'var(--border-radius)'
    };
    return (
        <div className="avatar" style={avatarStyle} onClick={onClick}>
            {user?.avatar_url ? (
                <img src={getFullUrl(user.avatar_url)} alt={user.display_name} />
            ) : (
                user?.display_name?.charAt(0).toUpperCase() || '?'
            )}
        </div>
    );
};

// Dynamic E2EE Encrypted Media Component
const EncryptedMedia = ({ msg, myPrivateKey, type, onClick, style }) => {
    const [mediaUrl, setMediaUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const fetchAndDecrypt = async () => {
            if (!myPrivateKey || !msg.encrypted_key || !msg.sender_ecdh_public_key) {
                setLoading(false);
                setError(true);
                return;
            }
            try {
                const sharedKEK = await deriveECDHSharedKey(myPrivateKey, msg.sender_ecdh_public_key);
                const rawAesKey = await decryptAESKeyWithECDH(msg.encrypted_key, sharedKEK);

                const res = await axios.get(getFullUrl(msg.file_url), { responseType: 'arraybuffer' });
                const combinedBuffer = new Uint8Array(res.data);

                const iv = combinedBuffer.slice(0, 12);
                const ciphertext = combinedBuffer.slice(12);

                const decryptedBuffer = await decryptData(ciphertext, rawAesKey, iv);

                let mimeType = 'application/octet-stream';
                if (type === 'image') mimeType = 'image/png';
                else if (type === 'audio' || type === 'voice') mimeType = 'audio/webm';

                const blob = new Blob([decryptedBuffer], { type: mimeType });
                const objectUrl = URL.createObjectURL(blob);

                if (isMounted) {
                    setMediaUrl(objectUrl);
                    setLoading(false);
                }
            } catch (err) {
                console.error('Failed to decrypt media file:', err);
                if (isMounted) {
                    setError(true);
                    setLoading(false);
                }
            }
        };

        fetchAndDecrypt();

        return () => {
            isMounted = false;
        };
    }, [msg, myPrivateKey, type]);

    if (loading) return <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>🔑 [DECRYPTING_SECURE_MEDIA...]</div>;
    if (error) return <div style={{ color: 'var(--danger)', fontSize: '0.78rem' }}>⚠️ [DECRYPTION_FAILED]</div>;

    if (type === 'image') {
        return (
            <img
                src={mediaUrl}
                alt="img"
                onClick={onClick ? () => onClick(mediaUrl) : undefined}
                style={style || { maxWidth: '250px', maxHeight: '250px', border: 'var(--border-style)', borderRadius: 'var(--border-radius)', display: 'block', transition: 'transform 0.15s', cursor: onClick ? 'pointer' : 'default' }}
            />
        );
    } else if (type === 'audio' || type === 'voice') {
        return <audio controls src={mediaUrl} style={{ filter: 'invert(1) hue-rotate(90deg)', maxWidth: '250px', display: 'block' }} />;
    } else {
        return (
            <a href={mediaUrl} download={msg.file_url?.split('/').pop()?.replace('.enc', '')} style={{ color: 'var(--primary)' }}>
                📄 [DOWNLOAD_SECURE_FILE] {msg.file_url?.split('/').pop()?.replace('.enc', '')}
            </a>
        );
    }
};

// Decrypt message helper
const decryptMessageList = async (messageList, myPrivateKey) => {
    if (!myPrivateKey) return messageList;

    const decryptedList = [];
    for (const msg of messageList) {
        if (msg.content?.startsWith('__E2EE__:') && msg.encrypted_key && msg.sender_ecdh_public_key) {
            try {
                const sharedKEK = await deriveECDHSharedKey(myPrivateKey, msg.sender_ecdh_public_key);
                const rawAesKey = await decryptAESKeyWithECDH(msg.encrypted_key, sharedKEK);
                
                const parts = msg.content.split(':');
                const iv = base64ToArrayBuffer(parts[1]);
                const ciphertext = base64ToArrayBuffer(parts[2]);
                
                const decryptedBuffer = await decryptData(ciphertext, rawAesKey, iv);
                const dec = new TextDecoder();
                const plaintext = dec.decode(decryptedBuffer);
                
                decryptedList.push({
                    ...msg,
                    content: plaintext,
                    is_decrypted: true
                });
                continue;
            } catch (e) {
                console.error('Failed to decrypt message:', msg.message_id, e);
                decryptedList.push({
                    ...msg,
                    content: '[Failed to decrypt secure message]',
                    is_decrypted: false
                });
                continue;
            }
        } else if (msg.file_url && msg.file_url.endsWith('.enc') && msg.encrypted_key && msg.sender_ecdh_public_key) {
            decryptedList.push({
                ...msg,
                is_encrypted_file: true
            });
            continue;
        }
        decryptedList.push(msg);
    }
    return decryptedList;
};

const Chat = () => {
    const { user, token, logout } = useContext(AuthContext);
    const { addToast, ToastContainer } = useToast();
    const { themeId, setTheme, themes } = useTheme();

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [blockedIds, setBlockedIds] = useState([]);
    const [conversations, setConversations] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [activeChatKeys, setActiveChatKeys] = useState([]);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [editingMsgId, setEditingMsgId] = useState(null);
    const [replyTo, setReplyTo] = useState(null); // { message_id, display_name, content }
    const [activeView, setActiveView] = useState('idle');
    const [myProfile, setMyProfile] = useState({});
    const [viewingUser, setViewingUser] = useState(null);
    const [groupName, setGroupName] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);

    // Advanced Features State
    const [mediaGalleryOpen, setMediaGalleryOpen] = useState(false);
    const [lightboxImage, setLightboxImage] = useState(null);
    const [addMembersModalOpen, setAddMembersModalOpen] = useState(false);
    const [selectedNewMembers, setSelectedNewMembers] = useState([]);

    // Screen width detection for responsive styling
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    // Typing Indicators State
    const [typingUsers, setTypingUsers] = useState({}); // { [userId]: { display_name, timeout } }
    const isTypingRef = useRef(false);
    const typingTimeoutRef = useRef(null);

    const socketRef = useRef();
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const avatarInputRef = useRef(null);
    const activeChatRef = useRef(activeChat);
    activeChatRef.current = activeChat;

    const api = axios.create({
        baseURL: `${BASE_URL}/api`,
        headers: { Authorization: `Bearer ${token}` }
    });

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // ---- Socket Setup ----
    useEffect(() => {
        socketRef.current = io(BASE_URL, { auth: { token } });

        socketRef.current.on('receive_message', async (msg) => {
            if (msg.sender_id !== user.id) {
                if (activeChatRef.current?.conversation_id === msg.conversation_id) {
                    const socketMsg = { ...msg };
                    if (msg.encrypted_keys && msg.encrypted_keys[user.id]) {
                        socketMsg.encrypted_key = msg.encrypted_keys[user.id];
                    }
                    const decrypted = await decryptMessageList([socketMsg], user.ecdhPrivateKey);
                    setMessages(prev => [...prev, ...decrypted]);
                    api.put(`/chat/conversations/${msg.conversation_id}/read`);
                }
            }
            fetchConversations();
        });

        socketRef.current.on('message_edited', ({ message_id, content }) => {
            setMessages(prev => prev.map(m => m.message_id === message_id ? { ...m, content } : m));
        });

        socketRef.current.on('message_deleted', ({ message_id }) => {
            setMessages(prev => prev.map(m => m.message_id === message_id ? { ...m, is_deleted: 1, content: '[DELETED]' } : m));
        });

        socketRef.current.on('user_status_change', () => {
            fetchConversations();
            performSearch(searchQuery);
        });

        // Typing Socket events
        socketRef.current.on('user_typing', ({ userId, display_name }) => {
            setTypingUsers(prev => {
                if (prev[userId]?.timeout) {
                    clearTimeout(prev[userId].timeout);
                }
                const timeout = setTimeout(() => {
                    setTypingUsers(current => {
                        const next = { ...current };
                        delete next[userId];
                        return next;
                    });
                }, 3000);

                return {
                    ...prev,
                    [userId]: { display_name, timeout }
                };
            });
        });

        socketRef.current.on('user_stopped_typing', ({ userId }) => {
            setTypingUsers(prev => {
                if (prev[userId]?.timeout) {
                    clearTimeout(prev[userId].timeout);
                }
                const next = { ...prev };
                delete next[userId];
                return next;
            });
        });

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, [token, user.id]);

    useEffect(() => {
        fetchConversations();
        performSearch('');
        fetchMyProfile();
        fetchBlockedIds();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const fetchMyProfile = async () => {
        try { const r = await api.get('/users/profile'); setMyProfile(r.data); } catch {}
    };
    const fetchBlockedIds = async () => {
        try { const r = await api.get('/users/blocks'); setBlockedIds(r.data); } catch {}
    };
    const fetchConversations = async () => {
        try { const r = await api.get('/chat/conversations'); setConversations(r.data); } catch {}
    };
    const performSearch = async (query) => {
        try {
            const r = await api.get(`/auth/users?search=${query}`);
            setSearchResults(r.data.filter(u => u.user_id !== user.id));
        } catch {}
    };
    const fetchMessages = async (convId) => {
        try { 
            const r = await api.get(`/chat/conversations/${convId}/messages`); 
            const decrypted = await decryptMessageList(r.data, user.ecdhPrivateKey);
            setMessages(decrypted); 
        } catch {}
    };
 
    const openChat = async (conv) => {
        handleTypingStop();
        setActiveChat(conv);
        setActiveView('chat');
        setTypingUsers({});
        setMediaGalleryOpen(false); // Close gallery initially
        fetchMessages(conv.conversation_id);
        socketRef.current.emit('join_room', conv.conversation_id);
        api.put(`/chat/conversations/${conv.conversation_id}/read`).then(fetchConversations);
        
        try {
            const r = await api.get(`/chat/conversations/${conv.conversation_id}/keys`);
            setActiveChatKeys(r.data);
        } catch (e) {
            console.error('Failed to fetch conversation member keys:', e);
        }
    };

    const startConversation = async (otherUserId) => {
        try {
            const r = await api.post('/chat/conversations', { otherUserId });
            await fetchConversations();
            const found = conversations.find(c => c.conversation_id === r.data.conversation_id);
            openChat(found || { conversation_id: r.data.conversation_id, conversation_type: 'private' });
        } catch (err) {
            addToast(err.response?.data?.error || 'Failed to open channel', 'error');
        }
    };

    const createGroup = async (e) => {
        e.preventDefault();
        if (groupMembers.length === 0) return addToast('Select at least one member', 'warning');
        try {
            const r = await api.post('/chat/conversations/group', { name: groupName, members: groupMembers });
            await fetchConversations();
            openChat({ conversation_id: r.data.conversation_id, conversation_type: 'group', name: groupName });
            setGroupName(''); setGroupMembers([]);
            addToast(`Group "${groupName}" created`);
        } catch { addToast('Failed to create group', 'error'); }
    };

    // Add selected users to an already made group chat
    const addMembersToGroup = async () => {
        if (selectedNewMembers.length === 0) return addToast('Select at least one member', 'warning');
        try {
            await api.post(`/chat/conversations/${activeChat.conversation_id}/members`, {
                members: selectedNewMembers
            });
            addToast('Members successfully added to the group!');
            setAddMembersModalOpen(false);
            setSelectedNewMembers([]);
            fetchConversations();
        } catch (err) {
            addToast(err.response?.data?.error || 'Failed to add group members', 'error');
        }
    };

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !activeChat) return;

        handleTypingStop();

        if (editingMsgId) {
            try {
                await api.put(`/chat/messages/${editingMsgId}`, { content: newMessage });
                socketRef.current.emit('edit_message', { conversation_id: activeChat.conversation_id, message_id: editingMsgId, content: newMessage });
                setMessages(prev => prev.map(m => m.message_id === editingMsgId ? { ...m, content: newMessage } : m));
                setNewMessage(''); setEditingMsgId(null);
                addToast('Message updated');
            } catch { addToast('Edit failed', 'error'); }
            return;
        }

        let payload = {
            content: newMessage,
            reply_to_message_id: replyTo?.message_id || null
        };

        const myPrivateKey = user.ecdhPrivateKey;
        const eligibleKeys = activeChatKeys.filter(k => k.ecdh_public_key);
        const canEncrypt = myPrivateKey && eligibleKeys.length > 0;

        if (canEncrypt) {
            try {
                const enc = new TextEncoder();
                const textBuffer = enc.encode(newMessage);
                
                const { ciphertext, iv, rawAesKey } = await encryptData(textBuffer);
                
                const encryptedKeys = {};
                for (const member of eligibleKeys) {
                    const sharedKEK = await deriveECDHSharedKey(myPrivateKey, member.ecdh_public_key);
                    const encAesKey = await encryptAESKeyWithECDH(rawAesKey, sharedKEK);
                    encryptedKeys[member.user_id] = encAesKey;
                }
                
                const ciphertextBase64 = arrayBufferToBase64(ciphertext);
                const ivBase64 = arrayBufferToBase64(iv);
                
                payload = {
                    content: `__E2EE__:${ivBase64}:${ciphertextBase64}`,
                    reply_to_message_id: replyTo?.message_id || null,
                    encrypted_keys: encryptedKeys
                };
            } catch (err) {
                console.error('Encryption failed, sending plaintext:', err);
            }
        }

        try {
            const r = await api.post(`/chat/conversations/${activeChat.conversation_id}/messages`, payload);
            const decrypted = await decryptMessageList([r.data], user.ecdhPrivateKey);
            setMessages(prev => [...prev, ...decrypted]);
            socketRef.current.emit('send_message', {
                ...r.data,
                encrypted_keys: payload.encrypted_keys || null
            });
            setNewMessage('');
            setReplyTo(null);
            fetchConversations();
        } catch (err) { addToast(err.response?.data?.error || 'Send failed', 'error'); }
    };

    const handleInputChange = (e) => {
        setNewMessage(e.target.value);
        if (!activeChat) return;

        if (!isTypingRef.current) {
            isTypingRef.current = true;
            socketRef.current.emit('typing_start', {
                conversation_id: activeChat.conversation_id,
                display_name: myProfile.display_name || user.username
            });
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            handleTypingStop();
        }, 2000);
    };

    const handleTypingStop = () => {
        if (isTypingRef.current && activeChat) {
            isTypingRef.current = false;
            socketRef.current.emit('typing_stop', { conversation_id: activeChat.conversation_id });
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeChat) return;
        await uploadFile(file);
        e.target.value = '';
    };

    const handleVoiceRecorded = async (blob) => {
        if (!activeChat) return;
        const file = new File([blob], `voice_note_${Date.now()}.webm`, { type: 'audio/webm' });
        await uploadFile(file);
    };

    const uploadFile = async (file) => {
        setUploading(true);
        try {
            let finalFile = file;
            let encryptedKeysString = null;
            let localEncryptedKeys = null;
            
            const myPrivateKey = user.ecdhPrivateKey;
            const eligibleKeys = activeChatKeys.filter(k => k.ecdh_public_key);
            const canEncrypt = myPrivateKey && eligibleKeys.length > 0;

            if (canEncrypt) {
                try {
                    const fileReader = new FileReader();
                    const fileDataBuffer = await new Promise((resolve, reject) => {
                        fileReader.onload = () => resolve(fileReader.result);
                        fileReader.onerror = reject;
                        fileReader.readAsArrayBuffer(file);
                    });

                    const { ciphertext, iv, rawAesKey } = await encryptData(fileDataBuffer);
                    
                    const encryptedKeys = {};
                    for (const member of eligibleKeys) {
                        const sharedKEK = await deriveECDHSharedKey(myPrivateKey, member.ecdh_public_key);
                        const encAesKey = await encryptAESKeyWithECDH(rawAesKey, sharedKEK);
                        encryptedKeys[member.user_id] = encAesKey;
                    }
                    
                    const combined = new Uint8Array(12 + ciphertext.byteLength);
                    combined.set(iv, 0);
                    combined.set(new Uint8Array(ciphertext), 12);
                    
                    const encryptedBlob = new Blob([combined], { type: 'application/octet-stream' });
                    finalFile = new File([encryptedBlob], `${file.name}.enc`, { type: 'application/octet-stream' });
                    encryptedKeysString = JSON.stringify(encryptedKeys);
                    localEncryptedKeys = encryptedKeys;
                } catch (err) {
                    console.error('File encryption failed, sending plaintext:', err);
                }
            }

            const formData = new FormData();
            formData.append('file', finalFile);
            if (replyTo?.message_id) formData.append('reply_to_message_id', replyTo.message_id);
            if (encryptedKeysString) formData.append('encrypted_keys', encryptedKeysString);

            const r = await axios.post(
                `${BASE_URL}/api/chat/conversations/${activeChat.conversation_id}/upload`,
                formData,
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
            );
            const decrypted = await decryptMessageList([r.data], user.ecdhPrivateKey);
            setMessages(prev => [...prev, ...decrypted]);
            socketRef.current.emit('send_message', {
                ...r.data,
                encrypted_keys: localEncryptedKeys
            });
            setReplyTo(null);
            fetchConversations();
            addToast('Media sent successfully');
        } catch (err) {
            addToast(err.response?.data?.error || 'Media upload failed', 'error');
        } finally {
            setUploading(false);
        }
    };

    const handleAvatarSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('avatar', file);

        try {
            const r = await axios.post(`${BASE_URL}/api/users/avatar`, formData, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            setMyProfile(prev => ({ ...prev, avatar_url: r.data.avatar_url }));
            addToast('Profile picture updated successfully!');
            fetchConversations();
        } catch (err) {
            addToast(err.response?.data?.error || 'Profile picture upload failed', 'error');
        } finally {
            e.target.value = '';
        }
    };

    const deleteMessage = async (msgId) => {
        try {
            await api.delete(`/chat/messages/${msgId}`);
            socketRef.current.emit('delete_message', { conversation_id: activeChat.conversation_id, message_id: msgId });
            setMessages(prev => prev.map(m => m.message_id === msgId ? { ...m, is_deleted: 1, content: '[DELETED]' } : m));
        } catch { addToast('Delete failed', 'error'); }
    };

    const blockUser = async (blockedId) => {
        try {
            await api.post('/users/blocks', { blocked_id: blockedId });
            setBlockedIds(prev => [...prev, blockedId]);
            if (viewingUser) setViewingUser({ ...viewingUser, isBlocked: true });
            addToast('User blocked');
            fetchConversations();
        } catch { addToast('Block failed', 'error'); }
    };

    const unblockUser = async (blockedId) => {
        try {
            await api.delete(`/users/blocks/${blockedId}`);
            setBlockedIds(prev => prev.filter(id => id !== blockedId));
            if (viewingUser) setViewingUser({ ...viewingUser, isBlocked: false });
            addToast('User unblocked');
        } catch { addToast('Unblock failed', 'error'); }
    };

    const openUserProfile = async (userId) => {
        try { const r = await api.get(`/users/profile/${userId}`); setViewingUser(r.data); }
        catch { addToast('Failed to load profile', 'error'); }
    };

    const updateMyProfile = async (e) => {
        e.preventDefault();
        try {
            const r = await api.put('/users/profile', {
                display_name: myProfile.display_name,
                bio: myProfile.bio
            });
            setMyProfile(r.data);
            addToast('Profile details saved successfully');
        } catch { addToast('Failed to save profile details', 'error'); }
    };

    // Filters shared media files reactively from the loaded messages
    const imagesGallery = messages.filter(m => m.message_type === 'image' && !m.is_deleted);
    const audioGallery = messages.filter(m => (m.message_type === 'audio' || m.message_type === 'voice') && !m.is_deleted);
    const docsGallery = messages.filter(m => m.message_type === 'file' && !m.is_deleted);

    // Render a single message bubble
    const renderMessage = (msg, idx) => {
        const isMine = msg.sender_id === user.id;
        const msgType = msg.message_type;

        return (
            <div key={idx} className={`message ${isMine ? 'sent' : 'received'}`}>
                {/* Reply preview */}
                {msg.reply_to_message_id && !msg.is_deleted && (
                    <div style={{ borderLeft: '3px solid rgba(255,255,255,0.2)', paddingLeft: '8px', marginBottom: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', opacity: 0.9 }}>
                        <span style={{ color: 'var(--primary)' }}>{msg.reply_display_name}</span>: {msg.reply_content || '[attachment]'}
                    </div>
                )}
                {/* Sender name (group) */}
                {!isMine && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--primary)', marginBottom: '4px', cursor: 'pointer' }} onClick={() => openUserProfile(msg.sender_id)}>
                        {msg.display_name}
                    </div>
                )}
                {/* Message content */}
                {msg.is_deleted ? (
                    <div style={{ color: 'var(--danger)', opacity: 0.6, fontStyle: 'italic' }}>[DELETED]</div>
                ) : msg.is_encrypted_file ? (
                    <EncryptedMedia msg={msg} myPrivateKey={user.ecdhPrivateKey} type={msgType} onClick={(decryptedUrl) => setLightboxImage(decryptedUrl)} />
                ) : msgType === 'image' ? (
                    <img
                        src={getFullUrl(msg.file_url)}
                        alt="img"
                        onClick={() => setLightboxImage(getFullUrl(msg.file_url))}
                        style={{ maxWidth: '250px', maxHeight: '250px', border: 'var(--border-style)', borderRadius: 'var(--border-radius)', display: 'block', pointerEvents: 'auto', cursor: 'pointer', transition: 'transform 0.15s' }}
                    />
                ) : (msgType === 'audio' || msgType === 'voice') ? (
                    <audio controls src={getFullUrl(msg.file_url)} style={{ filter: 'invert(1) hue-rotate(90deg)', maxWidth: '250px', display: 'block' }} />
                ) : msgType === 'file' ? (
                    <a href={getFullUrl(msg.file_url)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
                        📄 [DOWNLOAD_FILE] {msg.file_url?.split('/').pop()}
                    </a>
                ) : (
                    <div className="message-content">{msg.content}</div>
                )}
                {/* Footer */}
                <div className="message-time" style={{ display: 'flex', justifyContent: isMine ? 'space-between' : 'flex-start', gap: '10px', marginTop: '4px' }}>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {!msg.is_deleted && (
                        <span>
                            <span style={{ cursor: 'pointer', marginRight: '8px', opacity: 0.7 }} onClick={() => setReplyTo({ message_id: msg.message_id, display_name: msg.display_name, content: msg.content || '[attachment]' })}>[REPLY]</span>
                            {msgType === 'text' && isMine && <span style={{ cursor: 'pointer', marginRight: '8px', opacity: 0.7 }} onClick={() => { setEditingMsgId(msg.message_id); setNewMessage(msg.content); }}>[EDIT]</span>}
                            <span style={{ cursor: 'pointer', color: 'var(--danger)', opacity: 0.8 }} onClick={() => deleteMessage(msg.message_id)}>[DEL]</span>
                        </span>
                    )}
                </div>
            </div>
        );
    };

    const currentTheme = themes[themeId] || themes.matrix;

    // Mobile navigation state visibility rules
    const showSidebarOnMobile = !isMobile || activeView !== 'chat';
    const showChatOnMobile = !isMobile || activeView === 'chat';

    return (
        <div className="chat-app">
            <ToastContainer />
            {viewingUser && (
                <UserProfileModal targetUser={viewingUser} onClose={() => setViewingUser(null)}
                    onBlock={blockUser} onUnblock={unblockUser} onStartChat={startConversation} />
            )}

            {/* Lightbox full-screen Image display */}
            {lightboxImage && (
                <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
                    <div className="lightbox-content" onClick={e => e.stopPropagation()}>
                        <button className="lightbox-close" onClick={() => setLightboxImage(null)}>✕</button>
                        <img src={lightboxImage} alt="lightbox-preview" />
                    </div>
                </div>
            )}

            {/* Add Group Members Modal */}
            {addMembersModalOpen && (
                <div className="modal-overlay" onClick={() => setAddMembersModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setAddMembersModalOpen(false)}>[X]</button>
                        <h2>ADD_MEMBERS_TO_GROUP</h2>
                        <div style={{ margin: '1rem 0' }}>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                SELECT USERS ({selectedNewMembers.length} selected)
                            </label>
                            <div style={{ border: 'var(--border-style)', borderRadius: 'var(--border-radius)', padding: '0.75rem', maxHeight: '200px', overflowY: 'auto', background: 'var(--input-bg)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {searchResults.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No users available</span>}
                                {searchResults.map(u => (
                                    <label key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedNewMembers.includes(u.user_id)}
                                            onChange={e => setSelectedNewMembers(e.target.checked
                                                ? [...selectedNewMembers, u.user_id]
                                                : selectedNewMembers.filter(id => id !== u.user_id)
                                            )}
                                        />
                                        <Avatar user={u} size={28} />
                                        {u.display_name} <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>@{u.username}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <button className="btn-primary" onClick={addMembersToGroup}>ADD SELECTED USERS</button>
                    </div>
                </div>
            )}

            {/* SIDEBAR */}
            {showSidebarOnMobile && (
                <div className="sidebar glass">
                    <div className="sidebar-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>MATRIX_NET</h3>
                            {/* Theme Switcher */}
                            <div className="theme-switcher">
                                <button className="theme-btn" onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}>
                                    {currentTheme.icon} {currentTheme.name} ▾
                                </button>
                                {themeDropdownOpen && (
                                    <div className="theme-dropdown">
                                        {Object.entries(themes).map(([id, t]) => (
                                            <button
                                                key={id}
                                                className={`theme-option ${themeId === id ? 'active' : ''}`}
                                                onClick={() => {
                                                    setTheme(id);
                                                    setThemeDropdownOpen(false);
                                                }}
                                            >
                                                {t.icon} {t.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button style={btnStyle} onClick={() => setActiveView('profile')}>MY_PROFILE</button>
                            <button style={btnStyle} onClick={() => setActiveView('group')}>NEW_GROUP</button>
                            <button style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={logout}>DISCONNECT</button>
                        </div>
                    </div>

                    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px dashed var(--glass-border)' }}>
                        <input type="text" className="form-control" placeholder="SEARCH_USERS..." value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); performSearch(e.target.value); }} />
                    </div>

                    <div className="user-list" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div>
                            <h4 style={subHeaderStyle}>ACTIVE_LINKS</h4>
                            {conversations.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem' }}>NO CONNECTIONS YET</p>}
                            {conversations.map(c => {
                                const name = c.conversation_type === 'private' ? c.other_user_name : c.name;
                                const preview = c.last_message_deleted ? '[DELETED]' : c.last_message_type !== 'text' ? `[${(c.last_message_type || 'file').toUpperCase()}]` : c.last_message_content || '-- open channel --';
                                const otherUserAvatar = c.conversation_type === 'private' ? c.other_user_avatar_url : null;
                                const itemUser = { display_name: name, avatar_url: otherUserAvatar };

                                return (
                                    <div key={c.conversation_id} className={`user-item ${activeChat?.conversation_id === c.conversation_id ? 'active' : ''}`} onClick={() => openChat(c)}>
                                        <Avatar user={itemUser} size={48} />
                                        <div className="user-info" style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h4>{name}{c.conversation_type === 'group' && ' [GRP]'}</h4>
                                                {c.unread_count > 0 && <span style={{ background: 'var(--primary)', color: 'black', padding: '1px 6px', fontSize: '0.75rem', fontWeight: 'bold' }}>{c.unread_count}</span>}
                                            </div>
                                            <p style={{ fontSize: '0.72rem', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>{preview}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div>
                            <h4 style={subHeaderStyle}>{searchQuery ? 'SEARCH_RESULTS' : 'AVAILABLE_NODES'}</h4>
                            {searchResults.map(u => {
                                const isBlocked = blockedIds.includes(u.user_id);
                                return (
                                    <div key={u.user_id} className="user-item" style={{ justifyContent: 'space-between', cursor: 'default' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }} onClick={() => openUserProfile(u.user_id)}>
                                            <Avatar user={u} size={48} />
                                            <div className="user-info">
                                                <h4>{u.display_name}{isBlocked && <span className="blocked-badge">BLOCKED</span>}</h4>
                                                <p style={{ fontSize: '0.72rem' }}><span className={`status-dot ${u.status || 'offline'}`}></span>@{u.username}</p>
                                            </div>
                                        </div>
                                        {isBlocked
                                            ? <button style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => unblockUser(u.user_id)}>UNBLOCK</button>
                                            : <button style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => blockUser(u.user_id)}>BLOCK</button>
                                        }
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* MAIN PANEL */}
            {showChatOnMobile && (
                <div className="chat-main glass">
                    {activeView === 'chat' && activeChat ? (
                        <>
                            <div className="chat-header" style={{ justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    {/* Mobile Back Button */}
                                    {isMobile && (
                                        <button
                                            onClick={() => {
                                                handleTypingStop();
                                                setActiveChat(null);
                                                setActiveView('idle');
                                            }}
                                            style={{ ...btnStyle, marginRight: '10px', marginLeft: 0 }}
                                        >
                                            ⬅ BACK
                                        </button>
                                    )}
                                    <div 
                                        style={{ display: 'flex', alignItems: 'center', cursor: activeChat.conversation_type === 'private' ? 'pointer' : 'default' }}
                                        onClick={() => {
                                            if (activeChat.conversation_type === 'private' && activeChat.other_user_id) {
                                                openUserProfile(activeChat.other_user_id);
                                            }
                                        }}
                                    >
                                        <div style={{ marginRight: '1rem' }}>
                                            <Avatar user={{
                                                display_name: activeChat.conversation_type === 'private' ? activeChat.other_user_name : activeChat.name,
                                                avatar_url: activeChat.conversation_type === 'private' ? activeChat.other_user_avatar_url : activeChat.avatar_url
                                            }} size={48} />
                                        </div>
                                        <div>
                                            <h3>{activeChat.conversation_type === 'private' ? activeChat.other_user_name : activeChat.name}</h3>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{activeChat.conversation_type === 'group' ? 'GROUP_CHANNEL' : 'PRIVATE_CHANNEL'}</span>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {/* Add users button inside existing group chat */}
                                    {activeChat.conversation_type === 'group' && (
                                        <button
                                            style={btnStyle}
                                            title="Add members to this group"
                                            onClick={() => {
                                                performSearch('');
                                                setAddMembersModalOpen(true);
                                            }}
                                        >
                                            ➕ MEMBER
                                        </button>
                                    )}
                                    {/* Media Gallery Toggle Button */}
                                    <button
                                        style={{ ...btnStyle, background: mediaGalleryOpen ? 'var(--primary)' : 'transparent', color: mediaGalleryOpen ? 'var(--bg-darker)' : 'var(--primary)' }}
                                        title="Media Gallery"
                                        onClick={() => setMediaGalleryOpen(!mediaGalleryOpen)}
                                    >
                                        🖼️ MEDIA
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                                    <div className="messages">
                                        {messages.map((msg, idx) => renderMessage(msg, idx))}
                                        <div ref={messagesEndRef} />
                                    </div>

                                    {/* Typing indicators */}
                                    <div className="typing-indicator">
                                        {Object.values(typingUsers).length > 0 && (
                                            <>
                                                <span>
                                                    {Object.values(typingUsers).map(u => u.display_name).join(', ')}{' '}
                                                    {Object.values(typingUsers).length === 1 ? 'is' : 'are'} typing
                                                </span>
                                                <div className="typing-dots">
                                                    <span></span>
                                                    <span></span>
                                                    <span></span>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="chat-input-area">
                                        {replyTo && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', marginBottom: '6px', borderLeft: '3px solid var(--primary)', background: 'rgba(255,255,255,0.05)', fontSize: '0.8rem' }}>
                                                <span>REPLY_TO <span style={{ color: 'var(--primary)' }}>{replyTo.display_name}</span>: {replyTo.content?.substring(0, 40)}{replyTo.content?.length > 40 ? '...' : ''}</span>
                                                <button onClick={() => setReplyTo(null)} style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'var(--danger)', marginLeft: '8px' }}>✕</button>
                                            </div>
                                        )}
                                        {editingMsgId && (
                                            <div style={{ padding: '4px 0', marginBottom: '4px', fontSize: '0.8rem', color: '#ff9900' }}>
                                                [EDITING_MODE] — <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setEditingMsgId(null); setNewMessage(''); }}>CANCEL</span>
                                            </div>
                                        )}
                                        <form className="chat-form" onSubmit={sendMessage} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <input ref={fileInputRef} type="file" accept="image/*,audio/*,.pdf,.txt" style={{ display: 'none' }} onChange={handleFileUpload} />
                                            <button type="button" style={{ ...btnStyle, marginLeft: 0, padding: '6px 10px', fontSize: '1rem' }} title="Attach file" onClick={() => fileInputRef.current.click()} disabled={uploading}>
                                                {uploading ? '...' : '📎'}
                                            </button>

                                            <VoiceRecorder onRecorded={handleVoiceRecorded} disabled={uploading} />

                                            <input
                                                type="text"
                                                className="chat-input"
                                                placeholder={editingMsgId ? 'EDIT MESSAGE...' : 'TRANSMIT MESSAGE...'}
                                                value={newMessage}
                                                onChange={handleInputChange}
                                                style={{ flex: 1 }}
                                            />
                                            <button type="submit" className="btn-send">{editingMsgId ? 'SAVE' : 'SEND'}</button>
                                        </form>
                                    </div>
                                </div>

                                {/* Toggleable Right Media Gallery Drawer */}
                                {mediaGalleryOpen && (
                                    <div className="media-gallery-drawer">
                                        <div className="media-gallery-header">
                                            <h4>CONVERSATION_MEDIA</h4>
                                            <button style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setMediaGalleryOpen(false)}>✕</button>
                                        </div>
                                        <div className="media-gallery-content">
                                            {/* Images category */}
                                            <div>
                                                <h5 style={{ marginBottom: '8px', color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>IMAGES ({imagesGallery.length})</h5>
                                                {imagesGallery.length === 0 ? (
                                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No images shared</span>
                                                ) : (
                                                    <div className="gallery-grid">
                                                        {imagesGallery.map((m, i) => {
                                                            const isEncrypted = m.file_url && m.file_url.endsWith('.enc');
                                                            return (
                                                                <div key={i} className="gallery-thumb">
                                                                    {isEncrypted ? (
                                                                        <EncryptedMedia
                                                                            msg={m}
                                                                            myPrivateKey={user.ecdhPrivateKey}
                                                                            type="image"
                                                                            onClick={(decryptedUrl) => setLightboxImage(decryptedUrl)}
                                                                            style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                                                                        />
                                                                    ) : (
                                                                        <img
                                                                            src={getFullUrl(m.file_url)}
                                                                            alt="gallery-thumb"
                                                                            onClick={() => setLightboxImage(getFullUrl(m.file_url))}
                                                                            style={{ cursor: 'pointer' }}
                                                                        />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Audio/Voice category */}
                                            <div>
                                                <h5 style={{ marginBottom: '8px', color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>AUDIO NOTES ({audioGallery.length})</h5>
                                                {audioGallery.length === 0 ? (
                                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No audio notes shared</span>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {audioGallery.map((m, i) => {
                                                            const isEncrypted = m.file_url && m.file_url.endsWith('.enc');
                                                            return (
                                                                <div key={i} className="gallery-audio-item">
                                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                                        {new Date(m.created_at).toLocaleDateString()} {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                    </span>
                                                                    {isEncrypted ? (
                                                                        <EncryptedMedia msg={m} myPrivateKey={user.ecdhPrivateKey} type={m.message_type} />
                                                                    ) : (
                                                                        <audio controls src={getFullUrl(m.file_url)} style={{ width: '100%', filter: 'invert(1) hue-rotate(90deg)' }} />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Other documents category */}
                                            <div>
                                                <h5 style={{ marginBottom: '8px', color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>DOCUMENTS ({docsGallery.length})</h5>
                                                {docsGallery.length === 0 ? (
                                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No documents shared</span>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {docsGallery.map((m, i) => {
                                                            const isEncrypted = m.file_url && m.file_url.endsWith('.enc');
                                                            return isEncrypted ? (
                                                                <div key={i} style={{ fontSize: '0.8rem' }}>
                                                                    <EncryptedMedia msg={m} myPrivateKey={user.ecdhPrivateKey} type="file" />
                                                                </div>
                                                            ) : (
                                                                <a
                                                                    key={i}
                                                                    href={getFullUrl(m.file_url)}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    style={{ fontSize: '0.8rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                                >
                                                                    📄 {m.file_url?.split('/').pop()}
                                                                </a>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : activeView === 'profile' ? (
                        <div style={{ padding: '2rem', maxWidth: '480px' }}>
                            {isMobile && (
                                <button onClick={() => setActiveView('idle')} style={{ ...btnStyle, marginBottom: '20px', marginLeft: 0 }}>
                                    ⬅ BACK
                                </button>
                            )}
                            <h2 style={{ marginBottom: '2rem', letterSpacing: '2px' }}>MY_PROFILE</h2>
                            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={handleAvatarSelect}
                                />
                                <div className="avatar-upload-wrapper">
                                    <Avatar user={myProfile} size={80} onClick={() => avatarInputRef.current.click()} />
                                    <div className="avatar-upload-overlay" onClick={() => avatarInputRef.current.click()}>
                                        📷
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontWeight: 'bold' }}>{myProfile.display_name}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>@{myProfile.username}</div>
                                    <div style={{ fontSize: '0.85rem' }}>{myProfile.email}</div>
                                </div>
                            </div>
                            <form onSubmit={updateMyProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div><label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>DISPLAY_NAME</label>
                                    <input type="text" className="form-control" value={myProfile.display_name || ''} onChange={e => setMyProfile({ ...myProfile, display_name: e.target.value })} /></div>
                                <div><label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>BIO</label>
                                    <input type="text" className="form-control" value={myProfile.bio || ''} onChange={e => setMyProfile({ ...myProfile, bio: e.target.value })} /></div>
                                <button type="submit" className="btn-primary">SAVE_DETAILS</button>
                            </form>
                        </div>
                    ) : activeView === 'group' ? (
                        <div style={{ padding: '2rem', maxWidth: '480px' }}>
                            {isMobile && (
                                <button onClick={() => setActiveView('idle')} style={{ ...btnStyle, marginBottom: '20px', marginLeft: 0 }}>
                                    ⬅ BACK
                                </button>
                            )}
                            <h2 style={{ marginBottom: '2rem', letterSpacing: '2px' }}>CREATE_GROUP</h2>
                            <form onSubmit={createGroup} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                <div><label style={{ display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>GROUP_NAME</label>
                                    <input type="text" className="form-control" value={groupName} onChange={e => setGroupName(e.target.value)} required /></div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>SELECT_MEMBERS ({groupMembers.length} selected)</label>
                                    <div style={{ border: 'var(--border-style)', borderRadius: 'var(--border-radius)', padding: '0.75rem', maxHeight: '250px', overflowY: 'auto', background: 'var(--input-bg)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {searchResults.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No users found</span>}
                                        {searchResults.map(u => (
                                            <label key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={groupMembers.includes(u.user_id)}
                                                    onChange={e => setGroupMembers(e.target.checked ? [...groupMembers, u.user_id] : groupMembers.filter(id => id !== u.user_id))} />
                                                <Avatar user={u} size={28} />
                                                {u.display_name} <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>@{u.username}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <button type="submit" className="btn-primary">INITIALIZE_GROUP</button>
                            </form>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
                            <div style={{ fontSize: '3rem', opacity: 0.2 }}>{'>'}</div>
                            <h2 style={{ color: 'var(--text-muted)', letterSpacing: '4px' }}>AWAITING_INPUT</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Select a node from the directory or open an active link</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Chat;
