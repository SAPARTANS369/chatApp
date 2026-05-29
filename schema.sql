CREATE DATABASE IF NOT EXISTS chat_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE chat_app;

-- =========================
-- USERS
-- =========================
CREATE TABLE users (
    user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500) DEFAULT NULL,
    bio VARCHAR(255) DEFAULT NULL,
    status ENUM('offline', 'online', 'away', 'busy') NOT NULL DEFAULT 'offline',
    last_seen_at DATETIME DEFAULT NULL,
    ecdh_public_key TEXT DEFAULT NULL,
    encrypted_private_key TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- =========================
-- CONVERSATIONS
-- =========================
CREATE TABLE conversations (
    conversation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_type ENUM('private', 'group') NOT NULL,
    name VARCHAR(100) DEFAULT NULL,
    created_by INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_conversations_created_by
        FOREIGN KEY (created_by) REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    KEY idx_conversations_created_by (created_by),
    KEY idx_conversations_type (conversation_type)
) ENGINE=InnoDB;

-- =========================
-- MESSAGES
-- =========================
CREATE TABLE messages (
    message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT UNSIGNED NOT NULL,
    sender_id INT UNSIGNED NOT NULL,
    message_type ENUM('text', 'image', 'file', 'system') NOT NULL DEFAULT 'text',
    content TEXT DEFAULT NULL,
    file_url VARCHAR(500) DEFAULT NULL,
    reply_to_message_id BIGINT UNSIGNED DEFAULT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_messages_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_messages_sender
        FOREIGN KEY (sender_id) REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_messages_reply
        FOREIGN KEY (reply_to_message_id) REFERENCES messages(message_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    KEY idx_messages_conversation_time (conversation_id, created_at),
    KEY idx_messages_sender (sender_id)
) ENGINE=InnoDB;

-- =========================
-- CONVERSATION MEMBERS
-- =========================
CREATE TABLE conversation_members (
    conversation_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    member_role ENUM('member', 'admin') NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    muted_until DATETIME DEFAULT NULL,
    last_read_message_id BIGINT UNSIGNED DEFAULT NULL,

    PRIMARY KEY (conversation_id, user_id),

    CONSTRAINT fk_cm_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_cm_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_cm_last_read_message
        FOREIGN KEY (last_read_message_id) REFERENCES messages(message_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    KEY idx_cm_user (user_id)
) ENGINE=InnoDB;

-- =========================
-- BLOCKS
-- =========================
CREATE TABLE user_blocks (
    blocker_id INT UNSIGNED NOT NULL,
    blocked_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (blocker_id, blocked_id),

    CONSTRAINT fk_blocks_blocker
        FOREIGN KEY (blocker_id) REFERENCES users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_blocks_blocked
        FOREIGN KEY (blocked_id) REFERENCES users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    KEY idx_blocks_blocked (blocked_id)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW conversation_last_message AS
SELECT
    c.conversation_id,
    c.conversation_type,
    c.name,
    m.message_id,
    m.sender_id,
    m.content,
    m.file_url,
    m.created_at AS last_message_time
FROM conversations c
LEFT JOIN messages m
    ON m.message_id = (
        SELECT MAX(m2.message_id)
        FROM messages m2
        WHERE m2.conversation_id = c.conversation_id
    );

-- =========================
-- MESSAGE KEYS (E2EE)
-- =========================
CREATE TABLE IF NOT EXISTS message_keys (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    encrypted_key TEXT NOT NULL,
    
    PRIMARY KEY (message_id, user_id),
    
    CONSTRAINT fk_mk_message
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
        
    CONSTRAINT fk_mk_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
