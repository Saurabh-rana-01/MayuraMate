import React, { useState, useEffect, useRef } from 'react';
import { FaTrash, FaVideo, FaSignOutAlt, FaImage, FaReply, FaTimes, FaArrowLeft, FaSmile, FaPlus, FaPaperclip, FaCamera, FaEdit, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import EmojiPicker from 'emoji-picker-react';
import { uploadImage } from '../utils/CloudinaryService';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import {
    doc, updateDoc, serverTimestamp, collection,
    query, where, onSnapshot, addDoc, orderBy,
    writeBatch, getDocs, getDoc, setDoc, deleteDoc
} from 'firebase/firestore';
import { sendOnlineNotification } from '../utils/email';
import VideoCall from './VideoCall';
import sendIcon from '../assets/send_icon.png';
import tickBlue from '../assets/tick_blue.png';
import tickGrey from '../assets/tick_grey.png';

const Chat = ({ user }) => {
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
    const typingTimeoutRef = useRef(null);
    const messagesEndRef = useRef(null);
    const [unreadCounts, setUnreadCounts] = useState({});
    const unreadListeners = useRef({});

    const [error, setError] = useState(null);

    const [showVideoCall, setShowVideoCall] = useState(false);
    const [incomingCall, setIncomingCall] = useState(false);
    const videoCallRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false); // Header sync
    const [isCaller, setIsCaller] = useState(false);

    // Cloudinary State
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);
    const textareaRef = useRef(null);

    // Reply State
    // Reply State
    const [replyMsg, setReplyMsg] = useState(null);

    // Reaction State
    const [activeReactionId, setActiveReactionId] = useState(null);
    const [showFullPicker, setShowFullPicker] = useState(false);
    const longPressTimer = useRef(null);
    const touchStartX = useRef(null);
    const [swipeX, setSwipeX] = useState({ id: null, x: 0 });

    // Advanced Actions State
    const [viewingImage, setViewingImage] = useState(null);
    const [editingMsg, setEditingMsg] = useState(null);
    const [mobileActionsMsg, setMobileActionsMsg] = useState(null);

    const [selectedMessages, setSelectedMessages] = useState([]); // Array of selected msg objects

    // Modified to handle multi-selection initiation
    const handleTouchStart = (e, msg) => {
        if (selectedMessages.length > 0) return; // If already selecting, ignore long press re-trigger

        touchStartX.current = e.touches[0].clientX;
        longPressTimer.current = setTimeout(() => {
            // Start selection mode with this message
            setMobileActionsMsg(msg);
            setSelectedMessages([msg]);
        }, 500);
    };

    const handleMessageClick = (msg) => {
        if (selectedMessages.length > 0) {
            // Toggle selection
            const exists = selectedMessages.find(m => m.id === msg.id);
            let newSelection;
            if (exists) {
                newSelection = selectedMessages.filter(m => m.id !== msg.id);
            } else {
                newSelection = [...selectedMessages, msg];
            }

            setSelectedMessages(newSelection);

            // If we deselected until empty, clear standard mobile actions too
            if (newSelection.length === 0) {
                setMobileActionsMsg(null);
            } else if (newSelection.length === 1) {
                // If back to 1, show standard actions for that one
                setMobileActionsMsg(newSelection[0]);
            } else {
                // If > 1, standard actions (reply/edit) hidden in favor of bulk delete usually, 
                // but user asked for "only delete option appear".
                setMobileActionsMsg(null); // Hide single-item actions
            }
        }
    };

    // ... inside render ...

    const handleTouchMove = (e, msgId) => {
        if (touchStartX.current === null) return;
        const deltaX = e.touches[0].clientX - touchStartX.current;

        if (deltaX > 0) { // Only swipe right
            setSwipeX({ id: msgId, x: Math.min(deltaX, 80) });
            // Cancel long press if user is swiping
            if (deltaX > 10 && longPressTimer.current) {
                clearTimeout(longPressTimer.current);
            }
        }
    };

    const handleTouchEnd = (msg) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
        }

        if (swipeX.id === msg.id && swipeX.x > 60) {
            setReplyMsg(msg);
        }

        touchStartX.current = null;
        setSwipeX({ id: null, x: 0 });
    };

    const [showChatOnMobile, setShowChatOnMobile] = useState(false);

    const renderMessageText = (text) => {
        if (!text) return null;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);
        return parts.map((part, i) => {
            if (part.match(urlRegex)) {
                return (
                    <a
                        key={i}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} // Prevent triggering parent click handlers
                    >
                        {part}
                    </a>
                );
            }
            return part;
        });
    };

    // Listen for incoming calls
    useEffect(() => {
        if (!selectedUser) return;

        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        const callDocRef = doc(db, 'calls', id);

        const unsubscribe = onSnapshot(callDocRef, (snapshot) => {
            const data = snapshot.data();
            if (data && data.callerId !== user.uid && !data.answer) {
                setIncomingCall(true);
            } else {
                setIncomingCall(false);
            }
        });

        return () => unsubscribe();
    }, [selectedUser, user.uid]);

    // Handle Cloudinary Image Upload
    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file || !selectedUser) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            if (fileInputRef.current) fileInputRef.current.value = null;
            return;
        }

        // Validate file size (e.g., max 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB in bytes
        if (file.size > maxSize) {
            alert('File size exceeds 5MB limit.');
            if (fileInputRef.current) fileInputRef.current.value = null;
            return;
        }

        setIsUploading(true);
        try {
            const imageUrl = await uploadImage(file);
            console.log("Image uploaded:", imageUrl);

            const id = user.uid > selectedUser.uid
                ? `${user.uid + selectedUser.uid}`
                : `${selectedUser.uid + user.uid}`;

            await addDoc(collection(db, "chats", id, "messages"), {
                text: "📷 Image",
                image: imageUrl,
                from: user.uid,
                to: selectedUser.uid,
                createdAt: serverTimestamp(),
                seen: false
            });

            // Check if user is offline and send email
            const recipient = users.find(u => u.uid === selectedUser.uid);
            if (recipient && !recipient.isOnline) {
                // Send email notification
                console.log("Recipient is offline, sending email...");
                await sendOnlineNotification(recipient.email, user.displayName);
            }

        } catch (error) {
            console.error("Error uploading image:", error);
            alert("Failed to upload image.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = null;
        }
    };

    const startVideoCall = async () => {
        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        // Create the call document first to prevent race usage
        await setDoc(doc(db, 'calls', id), {
            callerId: user.uid,
        });

        setIsCaller(true);
        setShowVideoCall(true);
    };

    const acceptCall = () => {
        setIsCaller(false);
        setShowVideoCall(true);
        setIncomingCall(false);
    };

    // Fetch all users and listen for online status changes
    useEffect(() => {
        const usersRef = collection(db, "users");
        // DEBUG: Fetch ALL users to see who is actually in the DB
        const q = query(usersRef);
        // const q = query(usersRef, where("uid", "!=", user.uid));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let usersList = [];
            snapshot.forEach((doc) => {
                usersList.push(doc.data());
            });
            setUsers(usersList);
        }, (err) => {
            console.error("Error fetching users:", err);
            setError(err.message);
        });

        return () => unsubscribe();
    }, [user.uid]);

    // Track unread messages for all users
    useEffect(() => {
        if (!users.length) return;

        // Clean up previous listeners if users list changes
        Object.values(unreadListeners.current).forEach(unsub => unsub());
        unreadListeners.current = {};

        users.forEach(u => {
            if (u.uid === user.uid) return;

            const id = user.uid > u.uid
                ? `${user.uid + u.uid}`
                : `${u.uid + user.uid}`;

            const q = query(
                collection(db, "chats", id, "messages"),
                where("to", "==", user.uid),
                where("seen", "==", false)
            );

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const count = snapshot.size;
                console.log(`Unread count for ${u.displayName}: ${count}`);
                setUnreadCounts(prev => ({
                    ...prev,
                    [u.uid]: count
                }));
            });

            unreadListeners.current[u.uid] = unsubscribe;
        });

        return () => {
            Object.values(unreadListeners.current).forEach(unsub => unsub());
        };
    }, [users, user.uid]);

    // Fetch messages and listen for typing status
    useEffect(() => {
        if (!selectedUser) return;

        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        const messagesRef = collection(db, "chats", id, "messages");
        const q = query(messagesRef, orderBy("createdAt", "asc"));

        const unsubscribeMessages = onSnapshot(q, async (snapshot) => {
            let msgs = [];
            snapshot.forEach((doc) => {
                msgs.push({ id: doc.id, ...doc.data() });
            });
            setMessages(msgs);
            scrollToBottom();

            // Mark messages as seen if they're sent to current user
            const unseenMessages = msgs.filter(msg =>
                msg.to === user.uid && !msg.seen
            );

            for (const msg of unseenMessages) {
                const msgRef = doc(db, "chats", id, "messages", msg.id);
                await updateDoc(msgRef, {
                    seen: true,
                    seenAt: serverTimestamp()
                });
            }
        });

        // Listen for other user's typing status
        const typingStatusRef = doc(db, "chats", id, "typingStatus", selectedUser.uid);
        const unsubscribeTyping = onSnapshot(typingStatusRef, (doc) => {
            if (doc.exists()) {
                setIsOtherUserTyping(doc.data().isTyping);
            } else {
                setIsOtherUserTyping(false);
            }
        });

        return () => {
            unsubscribeMessages();
            unsubscribeTyping();
        };
    }, [selectedUser, user.uid]);

    const scrollToMessage = (msgId) => {
        const element = document.getElementById(`msg-${msgId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('message-highlight');
            setTimeout(() => {
                element.classList.remove('message-highlight');
            }, 1500);
        }
    };

    const handleDeleteMessage = async (msgId) => {
        if (!selectedUser) return;
        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        try {
            await deleteDoc(doc(db, "chats", id, "messages", msgId));
        } catch (error) {
            console.error("Error deleting message:", error);
            alert("Failed to delete message.");
        }
    };

    const startEditingMessage = (msg) => {
        setEditingMsg(msg);
        setNewMessage(msg.text);
        if (textareaRef.current) {
            textareaRef.current.focus();
            // Adjust height
            setTimeout(() => {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
            }, 0);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const handleInput = async (e) => {
        setNewMessage(e.target.value);

        // Auto-expand textarea
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
        }

        if (!selectedUser) return;

        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        if (!isTyping) {
            setIsTyping(true);
            const typingStatusRef = doc(db, "chats", id, "typingStatus", user.uid);
            await setDoc(typingStatusRef, { isTyping: true, lastTyped: serverTimestamp() });
        }

        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }

        typingTimeoutRef.current = setTimeout(async () => {
            setIsTyping(false);
            const typingStatusRef = doc(db, "chats", id, "typingStatus", user.uid);
            await updateDoc(typingStatusRef, { isTyping: false });
        }, 2000);
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() && !isUploading || !selectedUser) return;

        const capturedMessage = newMessage;
        const msgId = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        // Clear input and state immediately for UX
        setNewMessage("");
        const isEditing = !!editingMsg;
        const currentEditingMsg = editingMsg;
        setEditingMsg(null);
        setReplyMsg(null);
        if (textareaRef.current) textareaRef.current.style.height = '48px';

        try {
            if (isEditing) {
                const msgRef = doc(db, "chats", msgId, "messages", currentEditingMsg.id);
                await updateDoc(msgRef, {
                    text: capturedMessage,
                    editedAt: serverTimestamp()
                });
            } else {
                const chatRef = collection(db, "chats", msgId, "messages");
                const messageData = {
                    text: capturedMessage,
                    from: user.uid,
                    to: selectedUser.uid,
                    createdAt: serverTimestamp(),
                    seen: false,
                };

                if (replyMsg) {
                    messageData.replyTo = replyMsg.id;
                    messageData.replyText = replyMsg.text;
                    messageData.replyFrom = replyMsg.from;
                }

                await addDoc(chatRef, messageData);
            }

            // Reset typing status immediately after sending
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            setIsTyping(false);
            const typingStatusRef = doc(db, "chats", msgId, "typingStatus", user.uid); // Changed 'id' to 'msgId'
            await updateDoc(typingStatusRef, { isTyping: false });

            // Check if user is offline and send email
            // We check the latest state from our users list
            const recipient = users.find(u => u.uid === selectedUser.uid);
            if (recipient && !recipient.isOnline) {
                // Send email notification
                console.log("Recipient is offline, sending email...");
                await sendOnlineNotification(recipient.email, user.displayName);
            }
        } catch (err) {
            console.error("Error sending message:", err);
            setNewMessage(capturedMessage); // Restore message if send fails
            alert("Error sending message. Please try again.");
        }
    };

    const handleDeleteChat = async () => {
        if (!selectedUser) return;

        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        try {
            const messagesRef = collection(db, "chats", id, "messages");
            const snapshot = await getDocs(messagesRef);

            if (snapshot.empty) {
                console.log("No messages to delete.");
                return;
            }

            const batch = writeBatch(db);
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            setMessages([]);
        } catch (err) {
            console.error("Error deleting chat:", err);
            console.error("Error deleting chat");
        }
    };

    const handleEmojiClick = async (emojiData, msg) => {
        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        const msgRef = doc(db, "chats", id, "messages", msg.id);

        try {
            await updateDoc(msgRef, {
                [`reactions.${user.uid}`]: emojiData.emoji
            });
            setActiveReactionId(null);
        } catch (err) {
            console.error("Error adding reaction:", err);
        }
    };

    const toggleReactionPicker = (msgId) => {
        if (activeReactionId === msgId) {
            setActiveReactionId(null);
            setShowFullPicker(false);
        } else {
            setActiveReactionId(msgId);
            setShowFullPicker(false);
        }
    };

    const handleQuickReaction = async (emoji, msg) => {
        const id = user.uid > selectedUser.uid
            ? `${user.uid + selectedUser.uid}`
            : `${selectedUser.uid + user.uid}`;

        const msgRef = doc(db, "chats", id, "messages", msg.id);

        try {
            await updateDoc(msgRef, {
                [`reactions.${user.uid}`]: emoji
            });
            setActiveReactionId(null);
        } catch (err) {
            console.error("Error adding quick reaction:", err);
        }
    };

    const handleLogout = async () => {
        if (user) {
            await updateDoc(doc(db, "users", user.uid), {
                isOnline: false,
                lastSeen: serverTimestamp()
            });
        }
        await signOut(auth);
    };

    const handleDeleteUser = async (targetUser) => {
        if (!window.confirm(`Are you sure you want to delete user "${targetUser.displayName}"? This cannot be undone.`)) return;

        try {
            await deleteDoc(doc(db, "users", targetUser.uid));
            if (selectedUser?.uid === targetUser.uid) {
                setSelectedUser(null);
                setMessages([]);
            }
        } catch (err) {
            console.error("Error deleting user:", err);
            alert("Failed to delete user.");
        }
    };

    return (
        <div className={`chat-container ${showChatOnMobile ? 'show-chat' : ''}`}>
            {showVideoCall && selectedUser && (
                <VideoCall
                    ref={videoCallRef}
                    user={user}
                    chatId={user.uid > selectedUser.uid ? `${user.uid + selectedUser.uid}` : `${selectedUser.uid + user.uid}`}
                    recipientId={selectedUser.uid}
                    isCaller={isCaller}
                    onClose={() => {
                        setShowVideoCall(false);
                        setIncomingCall(false);
                    }}
                />
            )}
            <div className="sidebar">
                {/* ... existing sidebar ... */}
                <div className="sidebar-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {user.photoURL && <img src={user.photoURL} alt="Me" className="user-avatar" />}
                        <span style={{ fontWeight: 'bold' }}>{user.displayName}</span>
                    </div>
                    <button onClick={handleLogout} className="logout-btn" title="Log out">
                        <FaSignOutAlt />
                        <span>Log out</span>
                    </button>
                </div>
                <div className="users-list">
                    {users.map(u => (
                        <div
                            key={u.uid}
                            className={`user-item ${selectedUser?.uid === u.uid ? 'selected' : ''}`}
                            onClick={() => {
                                setSelectedUser(u);
                                setShowChatOnMobile(true);
                            }}
                            style={{
                                padding: '10px 15px',
                                borderBottom: '1px solid #f0f2f5',
                                cursor: 'pointer',
                                background: selectedUser?.uid === u.uid ? '#f0f2f5' : 'transparent',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                position: 'relative'
                            }}
                        >
                            <img src={u.photoURL} className="user-avatar" alt="u" />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {u.displayName} {u.uid === user.uid ? '(You)' : ''}
                                    </span>
                                </div>
                                <div style={{ fontSize: '12px', color: u.isOnline ? '#00a884' : '#667781' }}>
                                    {u.isOnline ? 'Online' : 'Offline'}
                                </div>
                            </div>
                            {unreadCounts[u.uid] > 0 && (
                                <div style={{
                                    backgroundColor: '#25d366',
                                    color: 'white',
                                    borderRadius: '50%',
                                    minWidth: '22px',
                                    height: '22px',
                                    padding: '2px',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    marginLeft: '10px',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                }}>
                                    {unreadCounts[u.uid]}
                                </div>
                            )}
                            {u.uid !== user.uid && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteUser(u);
                                    }}
                                    className="user-delete-btn"
                                    title="Delete User"
                                >
                                    <FaTrash size={10} />
                                </button>
                            )}
                        </div>
                    ))}
                    {error && <div style={{ padding: '10px', color: 'red', fontSize: '12px' }}>Error: {error}</div>}
                    {!error && users.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No other users found.</div>}
                </div>
            </div>

            {selectedUser ? (
                <div className="chat-area">
                    <div className="chat-header">
                        {selectedMessages.length > 0 ? (
                            <>
                                <button
                                    className="mobile-back-btn"
                                    onClick={() => {
                                        setSelectedMessages([]);
                                        setMobileActionsMsg(null);
                                    }}
                                    style={{ marginRight: 'auto' }}
                                >
                                    <FaArrowLeft />
                                    <span style={{ marginLeft: '10px', fontSize: '18px', fontWeight: 'bold' }}>{selectedMessages.length}</span>
                                </button>
                                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                    {/* Show normal actions ONLY if 1 item selected */}
                                    {selectedMessages.length === 1 && mobileActionsMsg && (
                                        <div onClick={() => { setReplyMsg(mobileActionsMsg); setMobileActionsMsg(null); setSelectedMessages([]); }} style={{ cursor: 'pointer', padding: '5px' }}>
                                            <FaReply size={20} color="#54656f" />
                                        </div>
                                    )}

                                    {/* Edit only if 1 item and it is ours */}
                                    {selectedMessages.length === 1 && mobileActionsMsg && mobileActionsMsg.from === user.uid && (
                                        <div onClick={() => { startEditingMessage(mobileActionsMsg); setMobileActionsMsg(null); setSelectedMessages([]); }} style={{ cursor: 'pointer', padding: '5px' }}>
                                            <FaEdit size={20} color="#54656f" />
                                        </div>
                                    )}

                                    {/* Delete - Show for single or bulk */}
                                    <div onClick={async () => {
                                        for (let m of selectedMessages) {
                                            if (m.from === user.uid) await handleDeleteMessage(m.id);
                                        }
                                        setSelectedMessages([]);
                                        setMobileActionsMsg(null);
                                    }} style={{ cursor: 'pointer', padding: '5px' }}>
                                        <FaTrash size={20} color="#54656f" />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <button
                                    className="mobile-back-btn"
                                    onClick={() => setShowChatOnMobile(false)}
                                >
                                    <FaArrowLeft />
                                </button>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <img src={selectedUser.photoURL} className="user-avatar" alt="selected" />
                                    <div style={{ marginLeft: '10px' }}>
                                        <div style={{ fontWeight: 'bold' }}>{selectedUser.displayName}</div>
                                        <div style={{ fontSize: '12px', color: '#54656f' }}>
                                            {isOtherUserTyping ? (
                                                <span style={{ color: '#00a884', fontWeight: 'bold' }}>Typing...</span>
                                            ) : (
                                                selectedUser.isOnline ? 'Online' : 'Offline'
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                                    {showVideoCall ? (
                                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                                            <button
                                                onClick={() => {
                                                    videoCallRef.current?.toggleMute();
                                                    setIsMuted(prev => !prev);
                                                }}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: isMuted ? '#ea4335' : '#54656f',
                                                    cursor: 'pointer',
                                                    fontSize: '18px',
                                                    padding: '8px',
                                                }}
                                                title={isMuted ? "Unmute" : "Mute"}
                                            >
                                                {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                                            </button>
                                            <button
                                                onClick={() => videoCallRef.current?.hangUp()}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: '#ea4335',
                                                    cursor: 'pointer',
                                                    fontSize: '18px',
                                                    padding: '8px',
                                                }}
                                                title="End Call"
                                            >
                                                <FaPhoneSlash />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            {incomingCall ? (
                                                <button
                                                    onClick={acceptCall}
                                                    style={{
                                                        background: '#25d366',
                                                        border: 'none',
                                                        color: 'white',
                                                        cursor: 'pointer',
                                                        padding: '8px 16px',
                                                        borderRadius: '20px',
                                                        fontWeight: 'bold',
                                                        animation: 'pulse 1s infinite'
                                                    }}
                                                >
                                                    Accept Video Call
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={startVideoCall}
                                                    style={{
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: '#54656f',
                                                        cursor: 'pointer',
                                                        fontSize: '18px',
                                                        padding: '8px',
                                                    }}
                                                    title="Video Call"
                                                >
                                                    <FaVideo />
                                                </button>
                                            )}
                                        </>
                                    )}
                                    <button
                                        onClick={handleDeleteChat}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            color: '#54656f',
                                            cursor: 'pointer',
                                            fontSize: '18px',
                                            padding: '8px',
                                        }}
                                        title="Delete Chat"
                                    >
                                        <FaTrash />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="messages-container" onClick={() => {
                        if (selectedMessages.length > 0) {
                            setSelectedMessages([]);
                            setMobileActionsMsg(null);
                        }
                    }}>
                        {messages.map((msg, index) => (
                            <div
                                key={index}
                                id={`msg-${msg.id}`}
                                className={`message ${msg.from === user.uid ? 'sent' : 'received'} ${selectedMessages.find(m => m.id === msg.id) ? 'mobile-selected' : ''}`}
                                onTouchStart={(e) => handleTouchStart(e, msg)}
                                onTouchMove={(e) => handleTouchMove(e, msg.id)}
                                onTouchEnd={() => handleTouchEnd(msg)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleMessageClick(msg);
                                }}
                                style={{
                                    position: 'relative', // Ensure anchor for absolute children
                                    alignSelf: msg.from === user.uid ? 'flex-end' : 'flex-start',
                                    backgroundColor: msg.from === user.uid ? '#d9fdd3' : '#ffffff',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    maxWidth: '60%',
                                    boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
                                    fontSize: '14px',
                                    lineHeight: '19px',
                                    marginBottom: '2px',
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    transform: swipeX.id === msg.id ? `translateX(${swipeX.x}px)` : 'none',
                                    transition: swipeX.id === msg.id ? 'none' : 'transform 0.2s ease-out'
                                }}
                            >
                                {msg.replyText && (
                                    <div
                                        className="quoted-message"
                                        onClick={() => msg.replyTo && scrollToMessage(msg.replyTo)}
                                    >
                                        <div className="quoted-message-sender">
                                            {msg.replyFrom === user.uid ? 'You' : (selectedUser?.displayName || 'User')}
                                        </div>
                                        <div className="quoted-message-text">{msg.replyText}</div>
                                    </div>
                                )}
                                {msg.image && (
                                    <div style={{ marginBottom: '5px' }} onClick={() => setViewingImage(msg.image)}>
                                        <img src={msg.image} alt="Shared" style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer' }} />
                                    </div>
                                )}
                                <div style={{ position: 'relative' }}>
                                    <span style={{ fontSize: '14px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                                        {renderMessageText(msg.text)}
                                        <span style={{ display: 'inline-block', width: '50px', height: '0', visibility: 'hidden' }}>&nbsp;</span>
                                    </span>
                                    <span style={{
                                        fontSize: '11px',
                                        color: '#999',
                                        whiteSpace: 'nowrap',
                                        float: 'right',
                                        marginTop: '4px', // Push down slightly if wrapping
                                        marginLeft: '-45px', // Pull back into the spacer void
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        position: 'relative',
                                        top: '4px'
                                    }}>
                                        {msg.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {msg.from === user.uid && (
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <img
                                                    src={msg.seen ? tickBlue : tickGrey}
                                                    alt={msg.seen ? "Seen" : "Sent"}
                                                    style={{ width: '14px', height: '14px' }}
                                                />
                                            </div>
                                        )}
                                    </span>
                                </div>
                                <div className="message-actions">
                                    <div className="action-btn" onClick={() => setReplyMsg(msg)} title="Reply">
                                        <FaReply size={16} />
                                    </div>
                                    {msg.from === user.uid && (
                                        <>
                                            <div className="action-btn" onClick={() => startEditingMessage(msg)} title="Edit">
                                                <FaEdit size={16} />
                                            </div>
                                            <div className="action-btn" onClick={() => handleDeleteMessage(msg.id)} title="Delete">
                                                <FaTrash size={16} />
                                            </div>
                                        </>
                                    )}
                                    <div
                                        className="action-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleReactionPicker(msg.id);
                                        }}
                                        title="React"
                                    >
                                        <FaSmile size={18} />
                                    </div>
                                </div>
                                {mobileActionsMsg?.id === msg.id && selectedMessages.length === 1 && (
                                    <div style={{ position: 'absolute', zIndex: 100, top: '-40px', left: msg.from === user.uid ? 'auto' : '0', right: msg.from === user.uid ? '0' : 'auto', width: 'max-content' }}>
                                        <div className="quick-reaction-bar" style={{ boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
                                            {['👍', '❤️', '😂', '😲', '😢', '🙏'].map((emoji) => (
                                                <span
                                                    key={emoji}
                                                    onClick={() => {
                                                        handleQuickReaction(emoji, mobileActionsMsg);
                                                        setMobileActionsMsg(null);
                                                        setSelectedMessages([]);
                                                    }}
                                                    className="quick-emoji"
                                                >
                                                    {emoji}
                                                </span>
                                            ))}
                                            <span
                                                className="quick-emoji-plus"
                                                onClick={() => {
                                                    setActiveReactionId(mobileActionsMsg.id);
                                                    setShowFullPicker(true);
                                                }}
                                            >
                                                <FaPlus size={12} />
                                            </span>
                                        </div>
                                    </div>
                                )}
                                {activeReactionId === msg.id && (
                                    <div style={{ position: 'absolute', zIndex: 100, bottom: '40px', left: msg.from === user.uid ? 'auto' : '0', right: msg.from === user.uid ? '0' : 'auto' }}>
                                        {!showFullPicker ? (
                                            <div className="quick-reaction-bar">
                                                {['👍', '❤️', '😂', '😲', '😢', '🙏'].map((emoji) => (
                                                    <span
                                                        key={emoji}
                                                        onClick={() => handleQuickReaction(emoji, msg)}
                                                        className="quick-emoji"
                                                    >
                                                        {emoji}
                                                    </span>
                                                ))}
                                                <span
                                                    className="quick-emoji-plus"
                                                    onClick={() => setShowFullPicker(true)}
                                                >
                                                    <FaPlus size={12} />
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="full-emoji-picker-container">
                                                <EmojiPicker
                                                    onEmojiClick={(emojiData) => handleEmojiClick(emojiData, msg)}
                                                    width={300}
                                                    height={350}
                                                />
                                            </div>
                                        )}
                                        <div
                                            style={{
                                                position: 'fixed',
                                                top: 0,
                                                left: 0,
                                                right: 0,
                                                bottom: 0,
                                                zIndex: 99
                                            }}
                                            onClick={() => {
                                                setActiveReactionId(null);
                                                setShowFullPicker(false);
                                            }}
                                        />
                                    </div>
                                )}
                                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                    <div className="message-reactions">
                                        {Object.entries(msg.reactions).map(([uid, emoji]) => (
                                            <span key={uid} className="reaction-emoji">
                                                {emoji}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {replyMsg && (
                        <div className="reply-preview">
                            <div className="reply-preview-content">
                                <div className="reply-preview-sender">
                                    Replying to {replyMsg.from === user.uid ? 'You' : (selectedUser?.displayName || 'User')}
                                </div>
                                <div className="reply-preview-text">{replyMsg.text}</div>
                            </div>
                            <div className="close-reply" onClick={() => setReplyMsg(null)}>
                                <FaTimes />
                            </div>
                        </div>
                    )}

                    {editingMsg && (
                        <div className="editing-indicator">
                            <div className="reply-preview-content">
                                <div className="reply-preview-sender">
                                    <span className="editing-label">Editing Message</span>
                                </div>
                                <div className="reply-preview-text">{editingMsg.text}</div>
                            </div>
                            <div className="close-reply" onClick={() => { setEditingMsg(null); setNewMessage(""); }}>
                                <FaTimes />
                            </div>
                        </div>
                    )}
                    <form className="whatsapp-input-container" onSubmit={handleSendMessage} style={{ alignItems: 'center' }}>
                        <button
                            type="button"
                            className="image-upload-btn"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            title="Send Image"
                        >
                            <FaImage />
                        </button>

                        <div className="whatsapp-input-bar">
                            <textarea
                                ref={textareaRef}
                                placeholder="Type a message..."
                                value={newMessage}
                                onChange={handleInput}
                                rows="1"
                                className="whatsapp-textarea"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage(e);
                                    }
                                }}
                            />
                        </div>

                        <input
                            type="file"
                            accept="image/*"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleFileSelect}
                        />

                        <button
                            type="submit"
                            className="whatsapp-send-btn"
                            disabled={!newMessage.trim() && !isUploading}
                        >
                            <img
                                src={sendIcon}
                                alt="Send"
                                style={{
                                    width: '42px',
                                    height: '42px'
                                }}
                            />
                        </button>
                    </form>
                </div >
            ) : (
                <div className="chat-area" style={{ justifyContent: 'center', alignItems: 'center', borderBottom: '6px solid #43c960' }}>
                    <div style={{ textAlign: 'center', color: '#41525d' }}>
                        <h1 style={{ fontSize: '32px', fontWeight: 300, marginBottom: '10px' }}>WhatsApp Web Clone</h1>
                        <p style={{ fontSize: '14px', color: '#667781' }}>Select a chat to start messaging.</p>
                    </div>
                </div>
            )
            }



            {viewingImage && (
                <div className="image-modal-overlay" onClick={() => setViewingImage(null)}>
                    <div className="modal-image-container" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close-btn" onClick={() => setViewingImage(null)}>
                            <FaTimes />
                        </button>
                        <img src={viewingImage} alt="Full screen" className="modal-image" />
                    </div>
                </div>
            )}
        </div >
    );
};

export default Chat;
