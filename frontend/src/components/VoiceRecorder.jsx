import React, { useState, useRef, useEffect } from 'react';

const VoiceRecorder = ({ onRecorded, disabled }) => {
    const [recording, setRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [permission, setPermission] = useState(null); // null | 'granted' | 'denied'
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);
    const canvasRef = useRef(null);
    const animFrameRef = useRef(null);
    const analyserRef = useRef(null);

    // Clean up on unmount
    useEffect(() => () => {
        clearInterval(timerRef.current);
        cancelAnimationFrame(animFrameRef.current);
    }, []);

    const drawWaveform = () => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;
        const ctx = canvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animFrameRef.current = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 2;
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
            ctx.beginPath();
            const sliceWidth = canvas.width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * canvas.height) / 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();
        };
        draw();
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setPermission('granted');

            // Set up analyser for waveform
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            chunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            mr.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                onRecorded(blob);
                stream.getTracks().forEach(t => t.stop());
                cancelAnimationFrame(animFrameRef.current);
                audioCtx.close();
            };
            mr.start();
            mediaRecorderRef.current = mr;
            setRecording(true);
            setSeconds(0);
            timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
            drawWaveform();
        } catch (err) {
            setPermission('denied');
            console.error('Mic permission denied:', err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && recording) {
            mediaRecorderRef.current.stop();
            setRecording(false);
            clearInterval(timerRef.current);
            setSeconds(0);
        }
    };

    const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

    if (permission === 'denied') {
        return <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>🎤 blocked</span>;
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {recording && (
                <>
                    <canvas ref={canvasRef} width={80} height={28}
                        style={{ border: '1px solid var(--glass-border)', background: 'var(--input-bg)' }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--danger)', minWidth: '38px', fontVariantNumeric: 'tabular-nums' }}>
                        ● {fmt(seconds)}
                    </span>
                </>
            )}
            <button
                type="button"
                title={recording ? 'Stop & send voice note' : 'Record voice note'}
                disabled={disabled}
                onClick={recording ? stopRecording : startRecording}
                style={{
                    background: recording ? 'var(--danger)' : 'transparent',
                    color: recording ? 'black' : 'var(--primary)',
                    border: `1px solid ${recording ? 'var(--danger)' : 'var(--primary)'}`,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                    animation: recording ? 'voicePulse 1s infinite' : 'none',
                }}
            >
                {recording ? '⏹' : '🎤'}
            </button>
        </div>
    );
};

export default VoiceRecorder;
