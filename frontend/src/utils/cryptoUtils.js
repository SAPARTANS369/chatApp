// frontend/src/utils/cryptoUtils.js
// Modern E2EE Cryptography Helper using the Native Web Crypto API (ECDH P-256 & AES-GCM 256-bit)

/**
 * Derives a 256-bit AES key from a user's password using PBKDF2 (KDF)
 */
export async function deriveKeyFromPassword(password, salt = 'chat-app-salt-value') {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: enc.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts user's ECDH Private Key using their Password
 */
export async function encryptPrivateKey(privateKeyPem, password) {
    const derivedKey = await deriveKeyFromPassword(password);
    const enc = new TextEncoder();
    const encodedData = enc.encode(privateKeyPem);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        derivedKey,
        encodedData
    );
    
    // Combine IV and Ciphertext to store easily as a single Base64 string
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts user's ECDH Private Key using their Password
 */
export async function decryptPrivateKey(encryptedPrivateKeyBase64, password) {
    const derivedKey = await deriveKeyFromPassword(password);
    const binary = Uint8Array.from(atob(encryptedPrivateKeyBase64), c => c.charCodeAt(0));
    const iv = binary.slice(0, 12);
    const ciphertext = binary.slice(12);
    
    const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        derivedKey,
        ciphertext
    );
    
    const dec = new TextDecoder();
    return dec.decode(decrypted);
}

/**
 * Generates an ECDH Key Pair (P-256)
 */
export async function generateECDHKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: 'P-256'
        },
        true,
        ['deriveKey', 'deriveBits']
    );
    
    const publicKeyBuffer = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyBuffer = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    
    const publicKeyPem = arrayBufferToBase64(publicKeyBuffer);
    const privateKeyPem = arrayBufferToBase64(privateKeyBuffer);
    
    return { publicKeyPem, privateKeyPem };
}

/**
 * Derives a Shared AES-GCM Key (KEK) using ECDH Key Agreement
 */
export async function deriveECDHSharedKey(myPrivateKeyPem, otherPublicKeyPem) {
    const privateKeyBuffer = base64ToArrayBuffer(myPrivateKeyPem);
    const publicKeyBuffer = base64ToArrayBuffer(otherPublicKeyPem);
    
    const myPrivateKey = await window.crypto.subtle.importKey(
        'pkcs8',
        privateKeyBuffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey']
    );
    
    const otherPublicKey = await window.crypto.subtle.importKey(
        'spki',
        publicKeyBuffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );
    
    return window.crypto.subtle.deriveKey(
        {
            name: 'ECDH',
            public: otherPublicKey
        },
        myPrivateKey,
        {
            name: 'AES-GCM',
            length: 256
        },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts a message or file with a newly generated AES session key
 */
export async function encryptData(dataArrayBuffer) {
    const aesKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        dataArrayBuffer
    );
    
    const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    
    return {
        ciphertext,
        iv,
        rawAesKey
    };
}

/**
 * Decrypts a message or file with a raw AES session key
 */
export async function decryptData(ciphertext, rawAesKey, iv) {
    const aesKey = await window.crypto.subtle.importKey(
        'raw',
        rawAesKey,
        'AES-GCM',
        false,
        ['decrypt']
    );
    
    return window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        ciphertext
    );
}

/**
 * Encrypts the raw AES key using the derived ECDH KEK
 */
export async function encryptAESKeyWithECDH(rawAesKey, ecdhSharedKey) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        ecdhSharedKey,
        rawAesKey
    );
    
    const combined = new Uint8Array(iv.length + encryptedKeyBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedKeyBuffer), iv.length);
    
    return arrayBufferToBase64(combined);
}

/**
 * Decrypts the encrypted AES key using the derived ECDH KEK
 */
export async function decryptAESKeyWithECDH(encryptedAesKeyBase64, ecdhSharedKey) {
    const binary = Uint8Array.from(atob(encryptedAesKeyBase64), c => c.charCodeAt(0));
    const iv = binary.slice(0, 12);
    const ciphertext = binary.slice(12);
    
    const decryptedKeyBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        ecdhSharedKey,
        ciphertext
    );
    
    return new Uint8Array(decryptedKeyBuffer);
}

// Utilities for encoding conversion
export function arrayBufferToBase64(buffer) {
    const binary = String.fromCharCode(...new Uint8Array(buffer));
    return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
