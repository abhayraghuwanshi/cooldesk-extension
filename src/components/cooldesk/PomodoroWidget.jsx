import { faBrain, faCoffee, faPause, faPlay, faRedoAlt } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';

export function PomodoroWidget() {
    // --- POMODORO LOGIC ---
    const [timeLeft, setTimeLeft] = useState(25 * 60);
    const [isActive, setIsActive] = useState(false);
    const [mode, setMode] = useState('work'); // 'work' or 'break'
    const timerRef = useRef(null);

    const WORK_TIME = 25 * 60;
    const BREAK_TIME = 5 * 60;

    useEffect(() => {
        if (isActive && timeLeft > 0) {
            timerRef.current = setInterval(() => {
                setTimeLeft((prev) => prev - 1);
            }, 1000);
        } else if (timeLeft === 0) {
            clearInterval(timerRef.current);
            setIsActive(false);
        }
        return () => clearInterval(timerRef.current);
    }, [isActive, timeLeft]);

    const toggleTimer = () => setIsActive(!isActive);

    const resetTimer = () => {
        setIsActive(false);
        setTimeLeft(mode === 'work' ? WORK_TIME : BREAK_TIME);
    };

    const switchMode = (newMode) => {
        setMode(newMode);
        setIsActive(false);
        setTimeLeft(newMode === 'work' ? WORK_TIME : BREAK_TIME);
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // --- AMBIENT TIME LOGIC ---
    const [dayProgress, setDayProgress] = useState(0);
    const [timeOfDay, setTimeOfDay] = useState('day');

    // --- CLOCK LOGIC ---
    const [currentTime, setCurrentTime] = useState(new Date());
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const updateAmbient = () => {
            const now = new Date();
            const totalMinutes = now.getHours() * 60 + now.getMinutes();
            const dayMinutes = 24 * 60;
            setDayProgress((totalMinutes / dayMinutes) * 100);

            const hour = now.getHours();
            if (hour >= 5 && hour < 12) setTimeOfDay('morning');
            else if (hour >= 12 && hour < 17) setTimeOfDay('day');
            else if (hour >= 17 && hour < 21) setTimeOfDay('evening');
            else setTimeOfDay('night');
        };

        updateAmbient();
        const interval = setInterval(updateAmbient, 60000);
        return () => clearInterval(interval);
    }, []);

    const getGradient = () => {
        switch (timeOfDay) {
            case 'morning': return 'linear-gradient(90deg, #FDB813 0%, #F97316 100%)';
            case 'day': return 'linear-gradient(90deg, #3B82F6 0%, #06B6D4 100%)';
            case 'evening': return 'linear-gradient(90deg, #F43F5E 0%, #8B5CF6 100%)';
            case 'night': return 'linear-gradient(90deg, #6366F1 0%, #A855F7 100%)';
            default: return 'linear-gradient(90deg, #3B82F6 0%, #06B6D4 100%)';
        }
    };

    // Derived styles
    const isWork = mode === 'work';

    return (
        <div
            className="pomodoro-widget"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                position: 'relative',
                width: '100%',
                height: '110px', // Fixed compact height
                backgroundColor: 'rgba(30, 41, 59, 0.4)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 24px', // Horizontal padding
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                overflow: 'hidden',
                transition: 'all 0.3s ease'
            }}
        >
            {/* Background Atmosphere (Subtle) */}
            <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: isWork
                    ? 'linear-gradient(135deg, rgba(220, 38, 38, 0.08), rgba(30, 41, 59, 0) 60%)'
                    : 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(30, 41, 59, 0) 60%)',
                zIndex: 0,
                transition: 'background 0.8s ease'
            }} />

            {/* LEFT SIDE: Timer & Controls */}
            <div style={{ zIndex: 1, display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={{
                    fontSize: '3.5rem',
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#F8FAFC',
                    letterSpacing: '-2px',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    textShadow: '0 2px 10px rgba(0,0,0,0.2)'
                }}>
                    {formatTime(timeLeft)}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={toggleTimer} style={{
                        width: '36px', height: '36px',
                        borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)',
                        background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                        color: '#E2E8F0',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '14px',
                        transition: 'all 0.2s ease',
                    }}>
                        <FontAwesomeIcon icon={isActive ? faPause : faPlay} style={{ marginLeft: isActive ? 0 : '2px' }} />
                    </button>
                    <button onClick={resetTimer} style={{
                        width: '36px', height: '36px',
                        borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)',
                        background: 'transparent',
                        color: '#94A3B8',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '13px',
                        transition: 'all 0.2s ease',
                    }}>
                        <FontAwesomeIcon icon={faRedoAlt} />
                    </button>
                </div>
            </div>

            {/* RIGHT SIDE: Clock & Mode Switcher */}
            <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>

                {/* Clock (Date on Hover) */}
                <div style={{ textAlign: 'right', height: '38px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{
                        fontSize: '18px',
                        fontWeight: 600,
                        color: '#E2E8F0',
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: '-0.5px'
                    }}>
                        {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{
                        fontSize: '11px',
                        color: '#94A3B8',
                        fontWeight: 500,
                        opacity: isHovered ? 1 : 0,
                        transform: isHovered ? 'translateY(0)' : 'translateY(-4px)',
                        transition: 'all 0.3s ease',
                        whiteSpace: 'nowrap'
                    }}>
                        {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                </div>

                {/* Segmented Control */}
                <div style={{
                    display: 'flex',
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '8px',
                    padding: '2px',
                    border: '1px solid rgba(255,255,255,0.05)'
                }}>
                    <button onClick={() => switchMode('work')} title="Focus Mode" style={{
                        border: 'none',
                        background: isWork ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                        color: isWork ? '#FCA5A5' : '#64748B',
                        width: '32px', height: '24px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px',
                        transition: 'all 0.2s ease'
                    }}>
                        <FontAwesomeIcon icon={faBrain} />
                    </button>
                    <button onClick={() => switchMode('break')} title="Break Mode" style={{
                        border: 'none',
                        background: !isWork ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                        color: !isWork ? '#6EE7B7' : '#64748B',
                        width: '32px', height: '24px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px',
                        transition: 'all 0.2s ease'
                    }}>
                        <FontAwesomeIcon icon={faCoffee} />
                    </button>
                </div>
            </div>

            {/* Ambient Day Bar (Bottom Line) */}
            <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                height: '3px',
                background: 'rgba(255, 255, 255, 0.02)'
            }}>
                <div style={{
                    height: '100%',
                    width: `${dayProgress}%`,
                    background: getGradient(),
                    transition: 'width 60s linear',
                    boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)'
                }} />
            </div>

        </div>
    );
}
