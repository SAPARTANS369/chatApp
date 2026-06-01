# CipherChat: Security Architecture
### End-to-End Encryption, Authentication & Password Hashing — Explained Simply

---

> This document covers the three core security pillars of CipherChat in plain, easy-to-understand language — but without skipping any technical details.

---

## Part 1: Password Hashing (bcrypt)

### What's the problem?

If a database gets stolen, you don't want hackers to see everyone's passwords. So we **never store the actual password**. Instead, we store a **scrambled fingerprint** of it called a **hash**.

### How bcrypt works

1. You type your password: `"MySecret123"`
2. bcrypt runs it through a one-way algorithm — you get back something like: `$2b$10$Kf8sL...xyz`
3. That scrambled string is stored in the database. **There is no way to reverse it back** to the original password.

When you log in next time:
- You type `"MySecret123"` again
- bcrypt scrambles it the same way
- It compares the two scrambled versions — if they match, you're in

### Why it's safer than regular hashing (like MD5/SHA)

bcrypt has a built-in **"work factor"** (called `saltRounds`). CipherChat uses **`saltRounds = 10`**, which means bcrypt intentionally runs the algorithm **1,024 times** in a loop to slow it down. This is called **key stretching**.

If a hacker steals the database and tries to guess passwords, they can only test ~100 guesses per second instead of millions. A 10-character password would take centuries to crack.

bcrypt also adds a random **salt** to each hash, so two users with the same password get completely different hashes. This defeats **rainbow table attacks** (pre-computed lists of common password hashes).

### In CipherChat's code:
```js
// Registration — hash the password before saving
const password_hash = await bcrypt.hash(password, 10);
// Store: password_hash into users table

// Login — verify by re-hashing and comparing
const isMatch = await bcrypt.compare(enteredPassword, storedHash);
if (!isMatch) return res.status(401).json({ error: 'Wrong password' });
```

---

## Part 2: Authentication (JWT)

### What's the problem?

HTTP is stateless — every request is standalone. The server doesn't remember who you are between requests. We need a way for you to prove your identity on every request **without sending your password every time**.

### The solution: JSON Web Tokens (JWT)

Think of a JWT like a **sealed stamp card** from a cafe. When you pay for a coffee, they stamp your card. Every time you come back, you show the stamp — they don't need to re-check your payment, they just verify the stamp is real.

### How JWT works in CipherChat

**Step 1 — Login:**
1. You send your `username` and `password` to the server.
2. The server looks up your account, verifies the bcrypt hash.
3. If correct, the server generates a **JWT token** signed with a secret key only the server knows.

The token looks like this (three parts separated by dots):
```
eyJhbGciOiJIUzI1NiJ9   ← Header (algorithm info)
.eyJ1c2VyX2lkIjoxfQ    ← Payload (your user_id, expiry)
.SflKxwRJSMeKKF2QT4    ← Signature (tamper-proof seal)
```

**Step 2 — Every request after login:**
1. Your browser attaches the JWT token to every API request in the HTTP header.
2. The server checks the signature — if someone tampered with the token (e.g., changed the user_id), the signature won't match and the request is rejected.
3. If valid, the server extracts your `user_id` and processes the request.

### Why JWTs are safe

- **Signed, not encrypted:** Anyone can read the payload (it's Base64), but nobody can *forge* or *modify* it without the server's secret key.
- **Stateless:** No session database needed — the token is self-contained.
- **Expiry built-in:** CipherChat tokens expire after a set time, so stolen tokens become useless.

```js
// Generate token on login
const token = jwt.sign({ user_id: user.user_id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Verify token on every protected route
const decoded = jwt.verify(token, process.env.JWT_SECRET);
req.user = decoded; // { user_id: 5 }
```

### Socket.io Authentication
When you open the chat page, Socket.io also needs to verify your identity for the WebSocket connection:
```js
// Client sends JWT during socket handshake
socket = io(SERVER_URL, { auth: { token: localStorage.getItem('token') } });

// Server verifies it before allowing connection
io.use((socket, next) => {
    const decoded = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
    socket.userId = decoded.user_id;
    next();
});
```

---

## Part 3: End-to-End Encryption (E2EE)

### What's the problem?

Even with HTTPS, the server can read your messages — it decrypts the HTTPS tunnel and sees plaintext. CipherChat goes further: **the server never sees your messages at all**. Everything is encrypted in your browser before it leaves your device.

### The Big Idea: Only You Have the Key

Imagine you and a friend want to exchange secret notes. You both own a **padlock** and a **key**. You each put your open padlock in a public mailbox. When the other person wants to send a note, they lock it with your padlock. Now only you — with your private key — can open it.

This is essentially what ECDH does.

---

### Step 1: Registration — Generating Your Keypair

When you create an account, your **browser** (not the server) generates two mathematically linked keys:

- **Public Key** — like your padlock. Safe to share with anyone.
- **Private Key** — like your key. Must never leave your device.

```
Browser generates:
  ECDH Public Key  → uploaded to server (stored in users.ecdh_public_key)
  ECDH Private Key → stays in browser... but needs to be stored somehow
```

**The challenge:** You close your browser. How do we save the private key without the server ever seeing it?

**The solution:** Encrypt it with your password.

```
Your password → PBKDF2 (100,000 iterations) → AES Master Key
AES Master Key → encrypts → Private Key
Encrypted Private Key → uploaded to server (stored in users.encrypted_private_key)
```

- **PBKDF2** is a "key stretching" function — it turns your password into a strong 256-bit AES key.
- **100,000 iterations** means even guessing your password is extremely slow.
- The server stores the encrypted private key blob. It cannot decrypt it because it doesn't know your password.

---

### Step 2: Login — Unlocking Your Private Key

1. You enter your password on the login screen.
2. The server returns your `encrypted_private_key`.
3. Your **browser** runs PBKDF2 on your password to re-derive the AES Master Key.
4. The browser decrypts your private key back into memory.
5. The raw private key **never touches the network** — ever.

---

### Step 3: Key Agreement (ECDH) — Making a Shared Secret

Before Alice and Bob can chat, they need a shared encryption key. Here's the magic:

```
Alice has: Alice's Private Key + Bob's Public Key
Bob has:   Bob's Private Key  + Alice's Public Key

Alice runs ECDH(Alice_Private, Bob_Public)   → Shared Secret
Bob runs   ECDH(Bob_Private, Alice_Public)   → Same Shared Secret ✓
```

This is the **Elliptic Curve Diffie-Hellman (ECDH P-256)** algorithm. Both parties independently compute the **exact same shared secret** without ever sending it over the network. This shared secret is called the **Key Encryption Key (KEK)**.

---

### Step 4: Sending a Message — Encryption

When Alice types a message and hits Send:

1. A **random session key** (AES-256 bit) is generated for this one message.
2. The message is encrypted with the session key using **AES-GCM** and a random **12-byte IV** (Initialization Vector — like a nonce/random salt).
3. The session key itself is encrypted using the **KEK** (the shared ECDH secret).
4. The browser sends to the server:
   - The **encrypted message** (ciphertext)
   - The **encrypted session key** (one copy per participant, stored in `message_keys`)

The server stores these blobs and broadcasts them via Socket.io. It cannot read any of it.

---

### Step 5: Receiving a Message — Decryption

When Bob receives the message:

1. Bob's browser fetches the encrypted session key from `message_keys` (the copy encrypted for Bob).
2. Bob derives the same KEK using `ECDH(Bob_Private, Alice_Public)`.
3. The session key is decrypted using the KEK.
4. The message is decrypted using the session key + IV.
5. Bob reads the plaintext message. Done.

---

### The Full E2EE Flow — At a Glance

```
REGISTRATION:
  Browser: generate ECDH keypair
  Browser: encrypt Private Key with PBKDF2(password) → AES-GCM
  Upload: Public Key + Encrypted Private Key → Server (stores blindly)

LOGIN:
  Server returns: Encrypted Private Key
  Browser: PBKDF2(password) → decrypt Private Key into memory

SEND MESSAGE (Alice → Bob):
  1. Generate random AES-256 session key
  2. Encrypt message with session key + random IV → ciphertext
  3. ECDH(Alice_Private, Bob_Public) → KEK
  4. Encrypt session key with KEK → encrypted_key
  5. Send: { ciphertext, encrypted_key } → Server
  6. Server stores in messages + message_keys tables, broadcasts via Socket.io

RECEIVE MESSAGE (Bob):
  1. ECDH(Bob_Private, Alice_Public) → KEK (same as Alice's)
  2. Decrypt encrypted_key with KEK → session key
  3. Decrypt ciphertext with session key → plaintext
  4. Display message ✓
```

---

### Why This is Genuinely Secure

| Threat | How CipherChat Handles It |
|---|---|
| **Server gets hacked** | Server only has ciphertext + encrypted keys — useless without user passwords |
| **Database gets leaked** | Passwords are bcrypt-hashed, private keys are AES-encrypted — both unreadable |
| **Man-in-the-middle on the wire** | HTTPS encrypts the transport + E2EE means even if HTTPS is broken, messages are still encrypted |
| **Stolen JWT token** | Token expires, doesn't give access to private key or messages |
| **Weak passwords** | PBKDF2 with 100k iterations + bcrypt with salt makes brute-force impractically slow |
| **Replay attacks** | Each message uses a unique random IV — replaying ciphertext with a different IV fails decryption |

---

### Web Crypto API — The Engine

All cryptography runs inside the browser using the **Web Crypto API** (`window.crypto.subtle`), a native browser standard. No third-party crypto libraries are needed for the core operations.

```js
// Generate ECDH keypair
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
);

// Derive shared KEK from ECDH
const kek = await crypto.subtle.deriveKey(
  { name: 'ECDH', public: otherPartyPublicKey },
  myPrivateKey,
  { name: 'AES-GCM', length: 256 },
  false, ['encrypt', 'decrypt']
);

// Encrypt a message
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  sessionKey,
  encodedMessage
);
```

---

*This document is a companion to `Project_Report.md`. All security operations described here run client-side in the browser — the server is intentionally kept zero-knowledge.*
