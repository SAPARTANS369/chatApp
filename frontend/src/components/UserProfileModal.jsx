import React from 'react';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const getFullUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${BASE_URL}${url}`;
};

const Avatar = ({ user, size = 64 }) => {
    const style = { width: size, height: size, fontSize: size * 0.45 };
    return (
        <div className="avatar" style={style}>
            {user?.avatar_url
                ? <img src={getFullUrl(user.avatar_url)} alt={user.display_name} />
                : user?.display_name?.charAt(0).toUpperCase()
            }
        </div>
    );
};

const UserProfileModal = ({ targetUser, onClose, onBlock, onUnblock, onStartChat }) => {
    if (!targetUser) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose}>[X]</button>
                <h2>USER_PROFILE</h2>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <Avatar user={targetUser} size={64} />
                    <div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                            {targetUser.display_name}
                            {targetUser.isBlocked && <span className="blocked-badge">BLOCKED</span>}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>@{targetUser.username}</div>
                    </div>
                </div>

                <div className="profile-stat">
                    <span>STATUS</span>
                    <span>
                        <span className={`status-dot ${targetUser.status || 'offline'}`}></span>
                        {(targetUser.status || 'offline').toUpperCase()}
                    </span>
                </div>
                {targetUser.bio && (
                    <div className="profile-stat">
                        <span>BIO</span>
                        <span>{targetUser.bio}</span>
                    </div>
                )}
                {targetUser.last_seen_at && (
                    <div className="profile-stat">
                        <span>LAST_SEEN</span>
                        <span>{new Date(targetUser.last_seen_at).toLocaleString()}</span>
                    </div>
                )}

                <div className="modal-actions">
                    {!targetUser.isBlocked ? (
                        <>
                            <button className="btn-send" onClick={() => { onStartChat(targetUser.user_id); onClose(); }}>
                                OPEN_CHANNEL
                            </button>
                            <button className="btn-danger" onClick={() => onBlock(targetUser.user_id)}>
                                BLOCK_USER
                            </button>
                        </>
                    ) : (
                        <button className="btn-send" onClick={() => onUnblock(targetUser.user_id)}>
                            UNBLOCK_USER
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UserProfileModal;
