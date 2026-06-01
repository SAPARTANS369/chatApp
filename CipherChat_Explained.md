# CipherChat: A Chill & Complete Guide to the Database & Inner Workings
*Prepared for M.Anas Faheem Khan (SAP ID: 70174002)*

---

Hey Anas! Welcome to the plain-English, deep-dive guide to **CipherChat**. 

If the main academic report feels a bit too "stuffy" and formal, this file is for you. We’re going to break down exactly how this app works under the hood, how the tables are connected, how the super-secure End-to-End Encryption (E2EE) math actually behaves in real life, and what all those complex SQL queries are doing. No confusing jargon—just clear, step-by-step explanations.

Let's dive in! 🚀

---

## 1. The Big Picture: How CipherChat Works

Imagine you want to send a secret letter to your friend, but the mailman (the server/database) is super nosey and reads everyone's letters. 

To solve this, CipherChat uses a **Zero-Knowledge Architecture**. The server is basically a "blind" mailman. It passes letters back and forth, but it has *absolutely no idea* what’s written in them or who is sending what to whom. All the encrypting and decrypting happens inside the users' browsers (the clients). By the time a message hits the network or the MySQL database, it is already scrambled into unreadable gibberish.

### The Stack:
* **Frontend:** React 19 (making the UI super snappy) + Vite (for lightning-fast builds) + Socket.io-client (for real-time chat updates).
* **Backend:** Node.js & Express (handling the REST APIs like registering, uploading files, etc.) + Socket.io (the WebSocket server that pushes new messages instantly to your screen).
* **Database:** MySQL (where all the encrypted data, users, and rooms are saved).
* **Attachments:** Multer (handling local files) + Cloudinary (storing the encrypted media attachments securely in the cloud).

---

## 2. The Magical E2EE Flow (Without Melting Your Brain 🧠)

Here is a step-by-step walkthrough of exactly how two users—let's call them **Neo** and **Trinity**—can chat securely.

### Step A: Neo Registers
1. The moment Neo signs up in his browser, React generates an **ECDH P-256 Keypair** (a Public Key and a Private Key). Think of the Public Key like a padlock that anyone can see, and the Private Key like the physical key that Neo keeps in his pocket.
2. To keep Neo's Private Key safe, the browser takes his password (`neo123`) and runs it through a function called **PBKDF2**. It hashes it **100,000 times** to make it super strong. This creates a special 256-bit AES key.
3. The browser encrypts Neo's Private Key using that AES key.
4. Neo sends his **Public Key** and the **Encrypted Private Key** to the database. The raw, decrypted Private Key is wiped from the browser's memory. It *never* travels to the server!

### Step B: Neo Logs In
1. When Neo logs back in, the server sends back his `encrypted_private_key`.
2. Neo types in his password. The browser instantly re-derives that special AES key, decrypts the private key, and holds it in the browser's temporary memory.

### Step C: Neo & Trinity Agree on a Secret Key (The ECDH Magic)
1. Neo wants to chat with Trinity. He asks the server for **Trinity's Public Key**.
2. Neo’s browser takes **Neo's Private Key** + **Trinity's Public Key** and does some smart math (Elliptic Curve Diffie-Hellman). This outputs a shared secret key (let's call it the **KEK** - Key Encryption Key).
3. Meanwhile, Trinity does the exact same math using **Trinity's Private Key** + **Neo's Public Key**. 
4. *Boom!* They both arrive at the exact same **KEK**, even though they never sent it to each other.

### Step D: Sending an Encrypted Message
1. Neo types *"Follow the white rabbit"*.
2. Rather than encrypting the message with their long-term KEK, Neo's browser generates a random, brand-new symmetric key (**AES-GCM 256-bit**) just for this single message. Let's call this the **Session Key**.
3. The browser encrypts the message text using this **Session Key**.
4. The browser encrypts the **Session Key** using their shared **KEK**.
5. Neo sends both the encrypted message and the encrypted session key to the server.
6. The server forwards it to Trinity. Trinity's browser decrypts the session key using their shared **KEK**, and then uses that session key to decrypt the actual message text. 

> [!NOTE]
> This is called **Perfect Forward Secrecy**. If a hacker somehow breaks the key for one single message, they still can't read any other messages because every single message gets its own unique, randomly generated session key!

---

## 3. Demystifying the Tables (Your Data Dictionary)

Let's look at how the database tables are set up in `schema.sql` and explain them simply.

### 3.1 `users`
*This is the phonebook.* It stores who the users are, their profile info, and their cryptographic keys.
* **`user_id`:** A unique number given to every user (1, 2, 3...).
* **`username` & `email`:** Unique identifiers so no two people can have the same username or email.
* **`password_hash`:** The password is run through `bcrypt` before saving. We never store plain text passwords!
* **`status`:** Tells us if they are `'online'`, `'offline'`, `'away'`, or `'busy'`.
* **`ecdh_public_key`:** The padlock key that anyone can see.
* **`encrypted_private_key`:** The encrypted physical key. Safe even if a hacker steals the database.

### 3.2 `conversations`
*This is the room manager.* A conversation represents a chat room. It could be private (just two people) or a group.
* **`conversation_type`:** Either `'private'` or `'group'`.
* **`name`:** The name of the room. If it's a private chat, this is left empty (NULL) because we dynamically fetch the other person's name instead.

### 3.3 `conversation_members`
*This is the guest list.* Because users can be in multiple chats and chats can have multiple users (Many-to-Many), this junction table links them together.
* **`conversation_id` & `user_id`:** Connects a specific user to a specific chat room.
* **`member_role`:** Can be `'member'` or `'admin'`.
* **`last_read_message_id`:** Crucial for unread counts! It points to the ID of the last message this user actually looked at in this room.

### 3.4 `messages`
*This is the chest of letters.* It stores every single message or attachment sent in the app.
* **`message_type`:** Can be `'text'`, `'image'`, `'file'`, `'system'`, `'audio'`, or `'voice'`.
* **`content`:** The encrypted, scrambled message text.
* **`file_url`:** If it's a picture or file, this holds the link to the file stored on Cloudinary.
* **`reply_to_message_id`:** If a user replies to a specific message, this links back to the original message. This is how we get threaded replies!
* **`is_deleted`:** A boolean (`TRUE`/`FALSE`). If you delete a message, we don't actually wipe the row; we just switch this to `TRUE` and replace the content with `[DELETED]` so the chat layout doesn't break.

### 3.5 `message_keys`
*This is the secret key exchange safe.* 
Since the messages are encrypted with a random **Session Key**, how do the recipients get that key? 
For every message sent, we encrypt the session key for each participant and save it here.
* **`message_id`:** Links to the message.
* **`user_id`:** Links to the recipient.
* **`encrypted_key`:** The session key, encrypted specifically for this user's ECDH key agreement. When they open the app, they fetch this key, decrypt it using their private key, and read the message!

### 3.6 `user_blocks`
*The blocking system.* 
* **`blocker_id`:** The person who clicked "Block".
* **`blocked_id`:** The person who got blocked.
* If a record exists here, the server will block you from creating private conversations or sending messages to that person. Simple and effective!

---

## 4. The Queries Explained (In Plain English!)

Let's take a look at the actual SQL queries running in your backend routes and explain what they are doing.

### 4.1 The Active Chats Feed (The "Beast" Query - Q10)
This query runs in `chat.js` under `router.get('/conversations')`. It is the query that builds your active chat list dashboard.
```sql
SELECT 
    c.conversation_id, c.conversation_type, c.name, c.updated_at,
    -- ... subqueries ...
FROM conversations c
JOIN conversation_members cm ON c.conversation_id = cm.conversation_id
WHERE cm.user_id = ?
ORDER BY c.updated_at DESC;
```
**What's happening here?**
1. It grabs all conversations that the logged-in user (`cm.user_id = ?`) belongs to.
2. It sorts them by `updated_at DESC` so that the chats with the newest messages show up at the very top of your screen.
3. **Subquery 1 (fetch other user's name):** If it's a private 1-on-1 chat, the conversation name in the database is NULL. So this subquery quickly jumps to `conversation_members`, finds the *other* person in the room, joins the `users` table, and retrieves their display name!
4. **Subquery 2 (last message details):** It quickly fetches the most recent message's content, type, and soft-delete status for this conversation so it can show a nice little preview text (like *"Neo: [Image]"* or *"Morpheus: Let's meet at..."*).
5. **Subquery 3 (unread message count):** This is the coolest part. It counts how many messages in this chat have a `message_id` *greater* than the user's `last_read_message_id` in `conversation_members`, ignoring messages sent by the user themselves. This is how the little red "3 unread messages" bubble works!

### 4.2 Start a Chat Room (Q12 & Q13)
When you click on someone's profile to chat:
```sql
SELECT c.conversation_id FROM conversations c
JOIN conversation_members cm1 ON c.conversation_id = cm1.conversation_id AND cm1.user_id = ?
JOIN conversation_members cm2 ON c.conversation_id = cm2.conversation_id AND cm2.user_id = ?
WHERE c.conversation_type = 'private'
```
**What's happening here?**
* The server checks if you already have a 1-on-1 private conversation with this user. If it finds one, it just returns that ID so you don't accidentally create duplicate chats. 
* If it doesn't find one, it starts a **Database Transaction** (using `beginTransaction()`). It inserts a new row into `conversations`, gets the new `conversation_id`, and then inserts two rows into `conversation_members` (one for you, one for the other user) to add you both to the room. If anything goes wrong, it rolls back everything so the database stays perfectly clean!

### 4.3 Sending a Message & Key Delivery (Q18)
When you click "Send" on an encrypted message:
```sql
INSERT INTO messages (conversation_id, sender_id, message_type, content, reply_to_message_id) 
VALUES (?, ?, ?, ?, ?);
```
**What's happening here?**
1. The server inserts your encrypted message into `messages`. Let's say it gets assigned ID `500`.
2. The server then takes the session key (which your browser encrypted separately for each member of the chat) and does a **bulk insert** into the `message_keys` table:
   ```sql
   INSERT INTO message_keys (message_id, user_id, encrypted_key) VALUES ?;
   ```
   If there are 3 people in the chat, it inserts 3 rows for message `500`—each containing the session key encrypted specifically for that member.
3. Finally, it updates `conversations.updated_at = NOW()` so this chat bumps to the top of everyone's feed!

### 4.4 Real-Time Presence tracking (Q19 & Q20 in `server.js`)
When you open or close the app, Socket.io listens to connection events and updates the database instantly:
```sql
UPDATE users SET status = 'online' WHERE user_id = ?;
```
And when you disconnect (close the tab):
```sql
UPDATE users SET status = 'offline', last_seen_at = NOW() WHERE user_id = ?;
```
This is how we show the green active dot on your friends' profiles or print *"Last seen 5 minutes ago"*.

---

## 5. Summary: Why is this structure so cool? 🌟

1. **Total Security:** Even if someone breaks into your MySQL database server and downloads the entire SQL database, they cannot read a single chat message. They will only see random AES-GCM cipher blocks, and they cannot decrypt them because the private keys are locked behind your users' raw passwords.
2. **Speed & Efficiency:** By indexing files by `created_at` and `conversation_id`, the database doesn't lag. MySQL can scan through millions of messages in a millisecond.
3. **Smooth Real-time Sync:** Socket.io acts like a secure, real-time highway. It validates your identity using JSON Web Tokens (JWT) and pushes alerts the second a message is inserted, keeping the chat lively and instant.

I hope this guide helps you ace your project submission and explains exactly how CipherChat operates under the hood! Let me know if you want me to expand on anything else! 🎉
