import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
    doc,
    setDoc,
    onSnapshot,
    updateDoc,
    addDoc,
    collection,
    getDoc,
    deleteDoc
} from 'firebase/firestore';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash } from 'react-icons/fa';

const servers = {
    iceServers: [
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302',
                'stun:stun3.l.google.com:19302',
                'stun:stun4.l.google.com:19302',
            ],
        },
    ],
    iceCandidatePoolSize: 10,
};

const VideoCall = React.forwardRef(({ user, chatId, recipientId, isCaller, onClose }, ref) => {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isRemoteVideoOff, setIsRemoteVideoOff] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState("Initializing...");
    const [isMinimized, setIsMinimized] = useState(true);
    const [isSwapped, setIsSwapped] = useState(false);
    const [dragPosition, setDragPosition] = useState(() => {
        if (typeof window === 'undefined') return { x: 0, y: 0 };
        // Use 280px for mobile, 320px for desktop
        const windowWidth = window.innerWidth < 768 ? 280 : 320;
        return {
            x: window.innerWidth - windowWidth,
            y: window.innerHeight - 320
        };
    });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const currentDragPos = useRef(dragPosition);
    useEffect(() => { currentDragPos.current = dragPosition; }, [dragPosition]);

    const [pipPosition, setPipPosition] = useState({
        x: typeof window !== 'undefined' ? window.innerWidth - 150 : 0,
        y: typeof window !== 'undefined' ? 80 : 0
    });
    const [isPipDragging, setIsPipDragging] = useState(false);
    const pipDragStart = useRef({ x: 0, y: 0 });


    const currentPipPos = useRef(pipPosition);
    useEffect(() => { currentPipPos.current = pipPosition; }, [pipPosition]);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const pc = useRef(null);
    const candidateQueue = useRef([]);
    const didPipDrag = useRef(false);
    const didDragMain = useRef(false);
    const unsubscribers = useRef([]);
    const isEnding = useRef(false);
    const isMounted = useRef(true);

    const hangUp = async (isManual = true) => {
        if (isEnding.current) return;
        isEnding.current = true;

        // Close UI immediately on the side that clicks hangup
        if (isManual) {
            onClose();
        }

        // Unsubscribe from all listeners immediately
        unsubscribers.current.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        unsubscribers.current = [];

        // Stop local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            setLocalStream(null);
        }

        if (pc.current) {
            if (pc.current.signalingState !== 'closed') {
                pc.current.close();
            }
        }

        // Clean up firestore only if it's a manual hangup (the person who clicked the button)
        if (isManual) {
            try {
                const callDocRef = doc(db, 'calls', chatId);
                await deleteDoc(callDocRef);
            } catch (err) {
                console.error("Error during call cleanup:", err);
            }
        }

        // Ensure UI is closed even if it wasn't manual (the person who was listening)
        if (!isManual) {
            onClose();
        }
    };

    React.useImperativeHandle(ref, () => ({
        toggleMute,
        hangUp: () => hangUp(true)
    }));

    useEffect(() => {
        isEnding.current = false;
        pc.current = new RTCPeerConnection(servers);

        const startCall = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

                // Fix: Check if connection is still open before adding tracks
                if (!pc.current || pc.current.signalingState === 'closed') {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                setLocalStream(stream);

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                stream.getTracks().forEach((track) => {
                    pc.current.addTrack(track, stream);
                });

                pc.current.ontrack = (event) => {
                    console.log("Track received:", event.track.kind);
                    setRemoteStream((prevStream) => {
                        const stream = prevStream || new MediaStream();
                        if (!stream.getTracks().find(t => t.id === event.track.id)) {
                            stream.addTrack(event.track);
                        }
                        return stream;
                    });
                };

                pc.current.onconnectionstatechange = () => {
                    console.log("Connection state:", pc.current.connectionState);
                    if (pc.current.connectionState === 'connected') {
                        setConnectionStatus("Connected");
                    } else if (pc.current.connectionState === 'failed') {
                        setConnectionStatus("Connection failed. Retrying...");
                    }
                };

                pc.current.oniceconnectionstatechange = () => {
                    console.log("ICE connection state:", pc.current.iceConnectionState);
                };

                const callDocRef = doc(db, 'calls', chatId);
                const offerCandidates = collection(callDocRef, 'offerCandidates');
                const answerCandidates = collection(callDocRef, 'answerCandidates');

                // Listener to end call if document is deleted (other side hung up)
                const unsubDelete = onSnapshot(callDocRef, (snapshot) => {
                    if (!snapshot.exists() && !isEnding.current) {
                        console.log("Call document deleted, hanging up...");
                        hangUp(false);
                    }
                });
                unsubscribers.current.push(unsubDelete);

                const processCandidates = async () => {
                    while (candidateQueue.current.length > 0) {
                        const candidate = candidateQueue.current.shift();
                        try {
                            await pc.current.addIceCandidate(candidate);
                        } catch (e) {
                            console.error("Error adding queued candidate:", e);
                        }
                    }
                };

                if (isCaller) {
                    setConnectionStatus("Calling...");
                    pc.current.onicecandidate = (event) => {
                        event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
                    };

                    const offerDescription = await pc.current.createOffer();
                    await pc.current.setLocalDescription(offerDescription);

                    const offer = {
                        sdp: offerDescription.sdp,
                        type: offerDescription.type,
                    };

                    await setDoc(callDocRef, { offer }, { merge: true });

                    const unsubAnswer = onSnapshot(callDocRef, async (snapshot) => {
                        const data = snapshot.data();
                        if (!pc.current) return;
                        if (!pc.current.currentRemoteDescription && data?.answer) {
                            if (!data.answer.type || !data.answer.sdp) {
                                console.error("Invalid answer format received:", data.answer);
                                return;
                            }
                            const answerDescription = new RTCSessionDescription(data.answer);
                            await pc.current.setRemoteDescription(answerDescription);
                            setConnectionStatus("Connected");
                            await processCandidates();
                        }
                    });
                    unsubscribers.current.push(unsubAnswer);

                    const unsubAnswerCandidates = onSnapshot(answerCandidates, (snapshot) => {
                        snapshot.docChanges().forEach((change) => {
                            if (change.type === 'added' && pc.current) {
                                const candidate = new RTCIceCandidate(change.doc.data());
                                if (pc.current.remoteDescription) {
                                    pc.current.addIceCandidate(candidate).catch(console.error);
                                } else {
                                    candidateQueue.current.push(candidate);
                                }
                            }
                        });
                    });
                    unsubscribers.current.push(unsubAnswerCandidates);

                    // Track remote video status
                    const unsubRemoteVideo = onSnapshot(callDocRef, (snapshot) => {
                        const data = snapshot.data();
                        if (data) {
                            setIsRemoteVideoOff(!!data.isVideoOff);
                        }
                    });
                    unsubscribers.current.push(unsubRemoteVideo);
                } else {
                    // Answerer - Wait for offer
                    setConnectionStatus("Waiting for offer...");

                    pc.current.onicecandidate = (event) => {
                        event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
                    };

                    const unsubOffer = onSnapshot(callDocRef, async (snapshot) => {
                        const data = snapshot.data();
                        if (!pc.current) return;
                        if (!pc.current.currentRemoteDescription && data?.offer) {
                            const offerDescription = data.offer;
                            if (!offerDescription.type || !offerDescription.sdp) {
                                console.error("Invalid offer received:", offerDescription);
                                setConnectionStatus("Error: Invalid offer");
                                return;
                            }

                            setConnectionStatus("Connecting...");
                            await pc.current.setRemoteDescription(new RTCSessionDescription(offerDescription));

                            const answerDescription = await pc.current.createAnswer();
                            await pc.current.setLocalDescription(answerDescription);

                            const answer = {
                                type: answerDescription.type,
                                sdp: answerDescription.sdp,
                            };

                            await updateDoc(callDocRef, { answer });
                            setConnectionStatus("Connected");
                            await processCandidates();
                        }
                    });
                    unsubscribers.current.push(unsubOffer);

                    // Track remote video status
                    const unsubRemoteVideo = onSnapshot(callDocRef, (snapshot) => {
                        const data = snapshot.data();
                        if (data) {
                            setIsRemoteVideoOff(!!data.isVideoOff);
                        }
                    });
                    unsubscribers.current.push(unsubRemoteVideo);

                    const unsubOfferCandidates = onSnapshot(offerCandidates, (snapshot) => {
                        snapshot.docChanges().forEach((change) => {
                            if (change.type === 'added' && pc.current) {
                                const candidate = new RTCIceCandidate(change.doc.data());
                                if (pc.current.remoteDescription) {
                                    pc.current.addIceCandidate(candidate).catch(console.error);
                                } else {
                                    candidateQueue.current.push(candidate);
                                }
                            }
                        });
                    });
                    unsubscribers.current.push(unsubOfferCandidates);
                }

            } catch (err) {
                console.error("Error starting call:", err);
                setConnectionStatus("Error: " + err.message);
            }
        };

        startCall();

        return () => {
            isMounted.current = false;
            // Clean up all listeners and close peer connection on unmount or re-render
            unsubscribers.current.forEach(unsub => unsub());
            unsubscribers.current = [];
            if (pc.current && pc.current.signalingState !== 'closed') {
                pc.current.close();
            }
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [chatId, isCaller, recipientId]);

    const toggleMute = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsMuted(!isMuted);
        }
    };

    const toggleVideo = async () => {
        if (localStream) {
            const enabled = !isVideoOff;
            localStream.getVideoTracks().forEach(track => {
                track.enabled = !enabled;
            });
            setIsVideoOff(enabled);

            // Update firestore so remote user knows
            try {
                const callDocRef = doc(db, 'calls', chatId);
                await updateDoc(callDocRef, { isVideoOff: enabled });
            } catch (err) {
                console.error("Error updating video status:", err);
            }
        }
    };

    // Ensure video streams stay connected to video elements
    useEffect(() => {
        if (localStream && localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream, isMinimized, isSwapped]);

    useEffect(() => {
        if (remoteStream && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream, isMinimized, isSwapped]);

    const handleDragStart = (e) => {
        setIsDragging(true);
        const clientX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
        const clientY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
        dragStart.current = {
            x: clientX - dragPosition.x,
            y: clientY - dragPosition.y
        };
        didDragMain.current = false;
    };

    const handleDragMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
        const clientY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;

        const newX = clientX - dragStart.current.x;
        const newY = clientY - dragStart.current.y;

        if (Math.abs(newX - dragPosition.x) > 5 || Math.abs(newY - dragPosition.y) > 5) {
            didDragMain.current = true;
        }

        // Keep within viewport bounds - use actual CSS dimensions
        const maxX = window.innerWidth - 240;
        const maxY = window.innerHeight - 245;

        setDragPosition({
            x: Math.max(0, Math.min(newX, maxX)),
            y: Math.max(0, Math.min(newY, maxY))
        });
    };

    const handleDragEnd = () => {
        setIsDragging(false);
        // Snapping removed to allow "floating anywhere"
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleDragMove);
            window.addEventListener('mouseup', handleDragEnd);
            window.addEventListener('touchmove', handleDragMove);
            window.addEventListener('touchend', handleDragEnd);
            return () => {
                window.removeEventListener('mousemove', handleDragMove);
                window.removeEventListener('mouseup', handleDragEnd);
                window.removeEventListener('touchmove', handleDragMove);
                window.removeEventListener('touchend', handleDragEnd);
            };
        }
    }, [isDragging]);

    // PIP drag handlers
    const handlePipDragStart = (e) => {
        e.stopPropagation();
        setIsPipDragging(true);
        const clientX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
        const clientY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
        pipDragStart.current = {
            x: clientX - pipPosition.x,
            y: clientY - pipPosition.y
        };
        didPipDrag.current = false;
    };

    const handlePipDragMove = (e) => {
        if (!isPipDragging) return;
        e.preventDefault();
        const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
        const clientY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;

        const newX = clientX - pipDragStart.current.x;
        const newY = clientY - pipDragStart.current.y;

        if (Math.abs(newX - pipPosition.x) > 5 || Math.abs(newY - pipPosition.y) > 5) {
            didPipDrag.current = true;
        }

        // Keep within viewport bounds
        const maxX = window.innerWidth - 120;
        const maxY = window.innerHeight - 160;

        setPipPosition({
            x: Math.max(0, Math.min(newX, maxX)),
            y: Math.max(0, Math.min(newY, maxY))
        });
    };

    const handlePipDragEnd = () => {
        setIsPipDragging(false);
        // Snapping removed to allow "floating anywhere"
    };

    const handlePipClick = (e) => {
        if (!didPipDrag.current) {
            setIsSwapped(!isSwapped);
        }
    };

    useEffect(() => {
        if (isPipDragging) {
            window.addEventListener('mousemove', handlePipDragMove);
            window.addEventListener('mouseup', handlePipDragEnd);
            window.addEventListener('touchmove', handlePipDragMove);
            window.addEventListener('touchend', handlePipDragEnd);
            return () => {
                window.removeEventListener('mousemove', handlePipDragMove);
                window.removeEventListener('mouseup', handlePipDragEnd);
                window.removeEventListener('touchmove', handlePipDragMove);
                window.removeEventListener('touchend', handlePipDragEnd);
            };
        }
    }, [isPipDragging]);



    if (isMinimized) {
        return (
            <>
                <div
                    className="video-call-minimized"
                    style={{
                        left: `${dragPosition.x}px`,
                        top: `${dragPosition.y}px`,
                        cursor: isDragging ? 'grabbing' : 'grab',
                        transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.19, 1, 0.22, 1)',
                        height: '180px' // Video only height
                    }}
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                    onClick={() => {
                        if (!didDragMain.current) {
                            setIsMinimized(false);
                        }
                    }}
                >
                    <div className="minimized-video">
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="minimized-remote-video"
                        />
                        {!remoteStream && (
                            <div className="minimized-placeholder">
                                <div className="minimized-avatar">
                                    {recipientId?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                            </div>
                        )}
                        <div className="minimized-local-pip">
                            <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className="minimized-local-video"
                            />
                            {isVideoOff && (
                                <div className="minimized-video-off-local">
                                    <FaVideoSlash />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <div className="video-call-container">
            <div className="video-call-header">
                <div>
                    <h3>Video Call</h3>
                    <p className="connection-status">{connectionStatus}</p>
                </div>
                <button
                    onClick={() => setIsMinimized(true)}
                    className="minimize-btn"
                    title="Minimize"
                >
                    ▼
                </button>
            </div>

            <div className="video-main-container">
                <div className="remote-video-wrapper">
                    <video
                        ref={isSwapped ? localVideoRef : remoteVideoRef}
                        autoPlay
                        playsInline
                        muted={isSwapped}
                        className="remote-video"
                    />
                    {isSwapped && (isVideoOff || isRemoteVideoOff) && (
                        <div className="video-placeholder">
                            <div className="placeholder-content">
                                <div className="avatar-placeholder" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                                    {isRemoteVideoOff && !isVideoOff ? (recipientId?.charAt(0)?.toUpperCase() || '?') : 'You'}
                                </div>
                                <p>{isRemoteVideoOff && !isVideoOff ? 'User Camera off' : 'Camera off'}</p>
                            </div>
                        </div>
                    )}
                    {!isSwapped && isRemoteVideoOff && (
                        <div className="video-placeholder">
                            <div className="placeholder-content">
                                <div className="avatar-placeholder">
                                    {recipientId?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                                <p>User Camera off</p>
                            </div>
                        </div>
                    )}
                </div>

                <div
                    className="local-video-wrapper"
                    style={{
                        left: `${pipPosition.x}px`,
                        top: `${pipPosition.y}px`,
                        cursor: isPipDragging ? 'grabbing' : 'grab',
                        transition: isPipDragging ? 'none' : 'all 0.3s cubic-bezier(0.19, 1, 0.22, 1)'
                    }}
                    onMouseDown={handlePipDragStart}
                    onTouchStart={handlePipDragStart}
                    onClick={handlePipClick}
                    title="Drag to move, Click to swap cameras"
                >
                    <video
                        ref={isSwapped ? remoteVideoRef : localVideoRef}
                        autoPlay
                        playsInline
                        muted={!isSwapped}
                        className="local-video"
                    />
                    {!isSwapped && isVideoOff && (
                        <div className="video-off-indicator">
                            <FaVideoSlash />
                        </div>
                    )}
                    {isSwapped && !remoteStream && (
                        <div className="video-off-indicator">
                            Waiting...
                        </div>
                    )}
                </div>
            </div>

            <div className="video-controls">
                <button
                    onClick={toggleMute}
                    className={`control-btn ${isMuted ? 'active-red' : ''}`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                </button>
                <button
                    onClick={toggleVideo}
                    className={`control-btn ${isVideoOff ? 'active-red' : ''}`}
                    title={isVideoOff ? "Turn on camera" : "Turn off camera"}
                >
                    {isVideoOff ? <FaVideoSlash /> : <FaVideo />}
                </button>
                <button
                    onClick={hangUp}
                    className="control-btn hangup-btn"
                    title="End call"
                >
                    <FaPhoneSlash />
                </button>
            </div>
        </div>
    );
});

export default VideoCall;
