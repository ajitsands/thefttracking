const { useState, useEffect, useRef, useCallback } = React;

// Audio Chime Synthesizer
function playChime(enabled) {
    if (!enabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, ctx.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
        gain1.gain.setValueAtTime(0.25, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.35);

        setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(980, ctx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.25);
            gain2.gain.setValueAtTime(0.25, ctx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start();
            osc2.stop(ctx.currentTime + 0.3);
        }, 150);
    } catch (e) {
        console.warn('Audio chime error:', e);
    }
}

function App() {
    // Theme & Navigation
    const [theme, setTheme] = useState(localStorage.getItem('theftcontrol_theme') || 'light');
    const [activeTab, setActiveTab] = useState('dashboard');
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

    // Core Data
    const [stats, setStats] = useState({
        status: 'online',
        fps: 0,
        active_camera: 'Laptop Webcam',
        total_today: 0,
        pending_review: 0,
        confirmed_theft: 0,
        false_alarms: 0,
        total_cameras: 4,
        engine_state: { detection_enabled: false, loitering_threshold: 8, sensitivity: 0.65, show_overlays: true }
    });
    const [events, setEvents] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [zones, setZones] = useState([]);
    const [toasts, setToasts] = useState([]);

    // Modals
    const [evidenceModalEvent, setEvidenceModalEvent] = useState(null);
    const [evidenceViewMode, setEvidenceViewMode] = useState('snapshot'); // 'snapshot' or 'video'
    const [officerNotes, setOfficerNotes] = useState('');
    const [editCamModalData, setEditCamModalData] = useState(null);
    const [sandsModalOpen, setSandsModalOpen] = useState(false);

    // Stream refresh timestamp
    const [streamTimestamp, setStreamTimestamp] = useState(Date.now());
    const lastEventIdRef = useRef(0);

    // Apply theme
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theftcontrol_theme', theme);
    }, [theme]);

    // Live clock
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Fetch Stats & Event Polling
    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            setStats(data);
        } catch (e) {
            console.warn('Stats fetch error:', e);
        }
    }, []);

    const fetchEvents = useCallback(async (status = 'ALL', severity = 'ALL') => {
        try {
            const res = await fetch(`/api/events?status=${status}&severity=${severity}&limit=40`);
            const data = await res.json();
            const newEvents = data.events || [];
            setEvents(newEvents);

            // Check if a new alert came in
            if (newEvents.length > 0) {
                const latest = newEvents[0];
                if (latest.id > lastEventIdRef.current) {
                    if (lastEventIdRef.current !== 0) {
                        playChime(soundEnabled);
                        // Add toast
                        setToasts(prev => [
                            {
                                id: latest.id,
                                type: latest.event_type,
                                camera: latest.camera_name,
                                zone: latest.zone_name,
                                confidence: latest.confidence,
                                time: new Date().toLocaleTimeString(),
                                event: latest
                            },
                            ...prev.slice(0, 3)
                        ]);
                    }
                    lastEventIdRef.current = latest.id;
                }
            }
        } catch (e) {
            console.warn('Events fetch error:', e);
        }
    }, [soundEnabled]);

    const fetchCameras = useCallback(async () => {
        try {
            const res = await fetch('/api/cameras');
            const data = await res.json();
            setCameras(data.cameras || []);
        } catch (e) {
            console.warn('Cameras fetch error:', e);
        }
    }, []);

    const fetchZones = useCallback(async () => {
        try {
            const res = await fetch('/api/zones');
            const data = await res.json();
            setZones(data.zones || []);
        } catch (e) {
            console.warn('Zones fetch error:', e);
        }
    }, []);

    // Initial load & Polling Loop
    useEffect(() => {
        fetchStats();
        fetchEvents();
        fetchCameras();
        fetchZones();

        const statsInterval = setInterval(fetchStats, 1500);
        const eventsInterval = setInterval(() => fetchEvents(), 2000);
        return () => {
            clearInterval(statsInterval);
            clearInterval(eventsInterval);
        };
    }, [fetchStats, fetchEvents, fetchCameras, fetchZones]);

    // Confirmation Modal & Notifications
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    const showNotification = useCallback((message, type = 'success', title = '') => {
        const id = Date.now() + Math.random();
        const toastItem = {
            id,
            isSystem: true,
            title: title || (type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Notice'),
            message,
            notifType: type,
            time: new Date().toLocaleTimeString()
        };
        setToasts(prev => [toastItem, ...prev.slice(0, 4)]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3500);
    }, []);

    // Toggle Camera Power
    const handleToggleCamera = async () => {
        try {
            const res = await fetch('/api/toggle_camera', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            setStreamTimestamp(Date.now());
            fetchStats();
            showNotification(data.camera_active ? 'Camera feed started' : 'Camera hardware released', 'info');
        } catch (e) {
            showNotification('Could not toggle camera hardware.', 'error');
        }
    };

    // Toggle AI Arming
    const handleToggleAI = async () => {
        try {
            const res = await fetch('/api/toggle_ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            fetchStats();
            showNotification(data.detection_enabled ? 'AI Theft Detection ARMED' : 'AI Engine set to Standby', data.detection_enabled ? 'success' : 'info');
        } catch (e) {
            showNotification('Could not toggle AI arming.', 'error');
        }
    };

    // Activate Camera
    const handleActivateCamera = async (camId) => {
        try {
            await fetch(`/api/cameras/${camId}/activate`, { method: 'POST' });
            fetchCameras();
            fetchStats();
            setStreamTimestamp(Date.now());
            showNotification('Switched active camera feed successfully!', 'success');
        } catch (e) {
            showNotification('Error activating camera feed.', 'error');
        }
    };

    // Delete Camera
    const handleDeleteCamera = (camId) => {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Camera',
            message: 'Are you sure you want to delete this camera from the system network?',
            onConfirm: async () => {
                try {
                    await fetch(`/api/cameras/${camId}`, { method: 'DELETE' });
                    fetchCameras();
                    fetchStats();
                    setStreamTimestamp(Date.now());
                    showNotification('Camera deleted successfully.', 'info');
                } catch (e) {
                    showNotification('Error deleting camera.', 'error');
                }
            }
        });
    };

    // Save Edited Camera
    const handleSaveEditedCamera = async (e) => {
        e.preventDefault();
        try {
            await fetch(`/api/cameras/${editCamModalData.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editCamModalData)
            });
            setEditCamModalData(null);
            fetchCameras();
            fetchStats();
            setStreamTimestamp(Date.now());
            showNotification('Camera parameters updated successfully!', 'success');
        } catch (e) {
            showNotification('Error saving camera parameters.', 'error');
        }
    };

    // Apply Zone Preset
    const handleApplyPreset = async (presetName) => {
        try {
            await fetch('/api/zones/preset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset: presetName })
            });
            fetchZones();
            setStreamTimestamp(Date.now());
            showNotification(`Preset layout applied successfully!`, 'success', 'Zone Calibrated');
        } catch (e) {
            showNotification('Error applying zone preset.', 'error');
        }
    };

    // Save Custom Zone
    const handleSaveZone = async (zoneData) => {
        try {
            await fetch('/api/zones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(zoneData)
            });
            fetchZones();
            setStreamTimestamp(Date.now());
            showNotification('Detection zone coordinates saved!', 'success');
        } catch (e) {
            showNotification('Error saving detection zone.', 'error');
        }
    };

    // Delete Zone
    const handleDeleteZone = (zoneId) => {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Detection Zone',
            message: 'Are you sure you want to remove this detection ROI from active surveillance?',
            onConfirm: async () => {
                try {
                    await fetch(`/api/zones/${zoneId}`, { method: 'DELETE' });
                    fetchZones();
                    setStreamTimestamp(Date.now());
                    showNotification('Detection zone removed.', 'info');
                } catch (e) {
                    showNotification('Error deleting zone.', 'error');
                }
            }
        });
    };

    // Trigger Test Alarm
    const handleTriggerTest = async () => {
        try {
            await fetch('/api/trigger_test_alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_type: 'CONCEALMENT_DETECTED',
                    confidence: 0.94,
                    severity: 'CRITICAL',
                    zone: 'Left Shelf Pick Zone'
                })
            });
            fetchEvents();
            fetchStats();
            showNotification('Simulated test alarm triggered!', 'warning', 'Security Alert');
        } catch (e) {
            showNotification('Error triggering test alarm.', 'error');
        }
    };

    // Clear Events
    const handleClearEvents = () => {
        setConfirmModal({
            isOpen: true,
            title: 'Clear Event History',
            message: 'Are you sure you want to clear all recorded theft incidents and logs from database?',
            onConfirm: async () => {
                try {
                    await fetch('/api/clear_events', { method: 'POST' });
                    fetchEvents();
                    fetchStats();
                    showNotification('Incident records cleared successfully.', 'info');
                } catch (e) {
                    showNotification('Error clearing incidents.', 'error');
                }
            }
        });
    };

    // Update Incident Status
    const handleUpdateIncidentStatus = async (status) => {
        if (!evidenceModalEvent) return;
        try {
            await fetch(`/api/events/${evidenceModalEvent.id}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: status,
                    notes: officerNotes,
                    reviewer: 'Security Duty Officer'
                })
            });
            setEvidenceModalEvent(null);
            fetchEvents();
            fetchStats();
            showNotification(`Incident status updated to ${status.replace('_', ' ')}`, 'success');
        } catch (e) {
            showNotification('Error updating incident status.', 'error');
        }
    };

    // Is Armed?
    const isArmed = stats.engine_state ? stats.engine_state.detection_enabled : false;

    return (
        <div className="app-wrapper">
            {/* 1. TOP HEADER (BRAND & CONTROLS) */}
            <header className="top-header">
                <div className="header-container">
                    {/* Brand */}
                    <div className="brand">
                        <div className="brand-icon">
                            <i className="fa-solid fa-shield-halved"></i>
                        </div>
                        <div className="brand-text">
                            <span className="brand-title">
                                AegisVision <span className="badge-retail">RETAIL AI</span>
                            </span>
                            <span className="brand-subtitle">Supermarket CCTV Theft Prevention</span>
                        </div>
                    </div>

                    {/* Right Controls */}
                    <div className="header-actions">
                        <div className="header-clock">
                            <i className="fa-regular fa-clock text-blue"></i>
                            <span>{currentTime}</span>
                        </div>

                        {/* Camera Power Toggle */}
                        <button
                            className={`btn btn-sm ${stats.status === 'online' ? 'btn-outline' : 'btn-danger'}`}
                            title="Turn On/Off Camera"
                            onClick={handleToggleCamera}
                        >
                            <i className="fa-solid fa-camera"></i>
                            <span>Cam: ON</span>
                        </button>

                        {/* AI Arming Toggle */}
                        <button
                            className={`btn btn-sm ${isArmed ? 'btn-danger' : 'btn-secondary'}`}
                            title="Arm or Disarm AI Surveillance"
                            onClick={handleToggleAI}
                        >
                            <i className={`fa-solid ${isArmed ? 'fa-shield-halved' : 'fa-shield'}`}></i>
                            <span>{isArmed ? 'AI: ARMED (REC)' : 'AI: Standby (Preview)'}</span>
                        </button>

                        {/* Sound Toggle */}
                        <button
                            className="btn-icon"
                            title="Toggle Alarm Sound"
                            onClick={() => setSoundEnabled(!soundEnabled)}
                        >
                            <i className={`fa-solid ${soundEnabled ? 'fa-volume-high' : 'fa-volume-xmark text-muted'}`}></i>
                        </button>

                        {/* Theme Toggle */}
                        <button
                            className="btn-icon"
                            title="Toggle Light/Dark Theme"
                            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                        >
                            <i className={`fa-solid ${theme === 'dark' ? 'fa-sun text-amber' : 'fa-moon'}`}></i>
                        </button>
                    </div>
                </div>
            </header>

            {/* 2. SUB-NAV MENU (RIGHT BELOW HEADER, COMPACT & SLEEK) */}
            <nav className="sub-navbar">
                <div className="subnav-container">
                    <div className="nav-links">
                        <button
                            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setActiveTab('dashboard')}
                        >
                            <i className="fa-solid fa-chart-pie"></i>
                            <span>Dashboard</span>
                        </button>

                        <button
                            className={`nav-btn ${activeTab === 'live-monitor' ? 'active' : ''}`}
                            onClick={() => setActiveTab('live-monitor')}
                        >
                            <i className="fa-solid fa-video"></i>
                            <span>Live Monitor</span>
                            <span className="nav-live-dot"></span>
                        </button>

                        <button
                            className={`nav-btn ${activeTab === 'incidents' ? 'active' : ''}`}
                            onClick={() => setActiveTab('incidents')}
                        >
                            <i className="fa-solid fa-triangle-exclamation"></i>
                            <span>Incident Review</span>
                            <span className="nav-badge-pill">{stats.pending_review || 0}</span>
                        </button>

                        <button
                            className={`nav-btn ${activeTab === 'zone-editor' ? 'active' : ''}`}
                            onClick={() => setActiveTab('zone-editor')}
                        >
                            <i className="fa-solid fa-draw-polygon"></i>
                            <span>Zone Editor</span>
                        </button>

                        <button
                            className={`nav-btn ${activeTab === 'camera-setup' ? 'active' : ''}`}
                            onClick={() => setActiveTab('camera-setup')}
                        >
                            <i className="fa-solid fa-mobile-screen-button"></i>
                            <span>Camera Setup</span>
                        </button>

                        <button
                            className={`nav-btn ${activeTab === 'reports' ? 'active' : ''}`}
                            onClick={() => setActiveTab('reports')}
                        >
                            <i className="fa-solid fa-file-shield"></i>
                            <span>Audit Logs</span>
                        </button>

                        <button
                            className={`nav-btn ${activeTab === 'help' ? 'active' : ''}`}
                            onClick={() => setActiveTab('help')}
                        >
                            <i className="fa-solid fa-circle-question"></i>
                            <span>Help</span>
                        </button>
                    </div>

                    <div className="subnav-right-info d-flex align-items-center gap-1">
                        <a
                            href="/documentation.html"
                            target="_blank"
                            className="btn btn-xs btn-outline text-blue"
                            style={{ textDecoration: 'none', fontWeight: 700 }}
                            title="Open Help & Technical Reference Guide in New Window"
                        >
                            <i className="fa-solid fa-circle-question"></i> Help
                        </a>
                        <span className="db-pill">
                            <i className="fa-solid fa-database"></i> MySQL: theft_control_db
                        </span>
                    </div>
                </div>
            </nav>

            {/* 3. POPUP NOTIFICATIONS & ALERT TOASTS CONTAINER */}
            <div className="toast-container">
                {toasts.map(t => (
                    t.isSystem ? (
                        <div key={t.id} className={`alert-toast-card toast-${t.notifType || 'info'}`}>
                            <div className="toast-icon-circle">
                                {t.notifType === 'success' && <i className="fa-solid fa-circle-check text-green"></i>}
                                {t.notifType === 'error' && <i className="fa-solid fa-circle-xmark text-red"></i>}
                                {t.notifType === 'warning' && <i className="fa-solid fa-triangle-exclamation text-amber"></i>}
                                {(!t.notifType || t.notifType === 'info') && <i className="fa-solid fa-circle-info text-blue"></i>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <strong className="font-sm" style={{ display: 'block', lineHeight: 1.2 }}>
                                    {t.title}
                                </strong>
                                <span className="font-xs text-secondary" style={{ display: 'block', marginTop: '2px' }}>
                                    {t.message}
                                </span>
                            </div>
                            <button
                                className="toast-close-btn"
                                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                                title="Dismiss"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    ) : (
                        <div key={t.id} className="alert-toast-card toast-theft">
                            <i className="fa-solid fa-triangle-exclamation text-red" style={{ fontSize: '1.3rem' }}></i>
                            <div style={{ flex: 1 }}>
                                <strong className="text-red font-sm" style={{ display: 'block' }}>
                                    🚨 {formatType(t.type)}
                                </strong>
                                <span className="font-xs text-muted">
                                    {t.camera} &bull; {t.zone} ({Math.round(t.confidence * 100)}%)
                                </span>
                                <div className="d-flex gap-1 mt-1">
                                    <button
                                        className="btn btn-xs btn-danger"
                                        onClick={() => {
                                            setEvidenceModalEvent(t.event);
                                            setOfficerNotes(t.event.notes || '');
                                            setEvidenceViewMode('snapshot');
                                        }}
                                    >
                                        Review
                                    </button>
                                    <button
                                        className="btn btn-xs btn-secondary"
                                        onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                ))}
            </div>

            {/* In-App Confirmation Modal */}
            {confirmModal.isOpen && (
                <div className="modal-overlay" style={{ zIndex: 10001 }}>
                    <div className="modal-content-box" style={{ maxWidth: '420px', padding: '1.25rem' }}>
                        <div className="d-flex align-items-center gap-2 mb-2">
                            <div className="toast-icon-circle" style={{ backgroundColor: 'var(--accent-amber-soft)', color: 'var(--accent-amber)', fontSize: '1.1rem' }}>
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '1rem', fontWeight: 800 }}>{confirmModal.title}</h4>
                            </div>
                        </div>
                        <p className="font-sm text-secondary mb-3">
                            {confirmModal.message}
                        </p>
                        <div className="d-flex justify-content-end gap-1">
                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-sm btn-danger"
                                onClick={() => {
                                    if (confirmModal.onConfirm) confirmModal.onConfirm();
                                    setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
                                }}
                            >
                                Confirm Action
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 4. MAIN VIEWPORT */}
            <main className="main-viewport">
                {activeTab === 'dashboard' && (
                    <DashboardTab
                        stats={stats}
                        events={events}
                        cameras={cameras}
                        isArmed={isArmed}
                        streamTimestamp={streamTimestamp}
                        onActivateCamera={handleActivateCamera}
                        onTriggerTest={handleTriggerTest}
                        onOpenEvidence={(evt) => {
                            setEvidenceModalEvent(evt);
                            setOfficerNotes(evt.notes || '');
                            setEvidenceViewMode('snapshot');
                        }}
                        onSwitchTab={setActiveTab}
                    />
                )}

                {activeTab === 'live-monitor' && (
                    <LiveMonitorTab
                        stats={stats}
                        cameras={cameras}
                        streamTimestamp={streamTimestamp}
                        onActivateCamera={handleActivateCamera}
                        onTriggerTest={handleTriggerTest}
                        onToggleAI={handleToggleAI}
                    />
                )}

                {activeTab === 'incidents' && (
                    <IncidentsTab
                        events={events}
                        onRefresh={fetchEvents}
                        onClear={handleClearEvents}
                        onOpenEvidence={(evt) => {
                            setEvidenceModalEvent(evt);
                            setOfficerNotes(evt.notes || '');
                            setEvidenceViewMode('snapshot');
                        }}
                    />
                )}

                {activeTab === 'zone-editor' && (
                    <ZoneEditorTab
                        zones={zones}
                        streamTimestamp={streamTimestamp}
                        onApplyPreset={handleApplyPreset}
                        onSaveZone={handleSaveZone}
                        onDeleteZone={handleDeleteZone}
                        onSwitchTab={setActiveTab}
                    />
                )}

                {activeTab === 'camera-setup' && (
                    <CameraSetupTab
                        cameras={cameras}
                        onActivateCamera={handleActivateCamera}
                        onOpenEdit={(cam) => setEditCamModalData({ ...cam })}
                        onDeleteCamera={handleDeleteCamera}
                        onRefreshCameras={fetchCameras}
                        onSwitchTab={setActiveTab}
                        showNotification={showNotification}
                    />
                )}

                {activeTab === 'reports' && (
                    <ReportsTab />
                )}

                {activeTab === 'help' && (
                    <HelpTab />
                )}
            </main>

            {/* APP FOOTER WITH SANDS LAB INTERACTIVE BUTTON */}
            <footer className="app-footer">
                <div className="d-flex align-items-center gap-2">
                    <i className="fa-solid fa-shield-halved text-blue"></i>
                    <span>AegisVision AI CCTV Theft Control</span>
                    <span className="text-muted font-xs">&bull; Enterprise Retail Edition</span>
                </div>

                <div className="d-flex align-items-center gap-2">
                    <button
                        className="sands-lab-btn"
                        onClick={() => setSandsModalOpen(true)}
                        title="Engineered by SaNDS Lab - Click for Support, WhatsApp & Products"
                    >
                        <i className="fa-solid fa-flask-vial text-blue"></i>
                        <span>Engineered By SaNDS Lab</span>
                        <i className="fa-solid fa-arrow-up-right-from-square font-xs text-muted"></i>
                    </button>
                </div>
            </footer>

            {/* 5. EVIDENCE REVIEW MODAL */}
            {evidenceModalEvent && (
                <div className="modal-overlay">
                    <div className="modal-content-box">
                        <div className="panel-header">
                            <div className="panel-title">
                                <i className="fa-solid fa-circle-play text-red"></i>
                                <span>Evidence: {formatType(evidenceModalEvent.event_type)}</span>
                            </div>
                            <button className="btn-icon" onClick={() => setEvidenceModalEvent(null)}>
                                &times;
                            </button>
                        </div>
                        <div className="panel-body">
                            {/* Evidence Switcher Bar */}
                            <div className="d-flex align-items-center justify-content-between mb-2">
                                <div className="d-flex gap-1">
                                    <button
                                        className={`btn btn-sm ${evidenceViewMode === 'snapshot' ? 'btn-primary' : 'btn-outline'}`}
                                        onClick={() => setEvidenceViewMode('snapshot')}
                                    >
                                        <i className="fa-solid fa-camera"></i> 📸 HD Snapshot
                                    </button>
                                    <button
                                        className={`btn btn-sm ${evidenceViewMode === 'video' ? 'btn-primary' : 'btn-outline'}`}
                                        onClick={() => setEvidenceViewMode('video')}
                                    >
                                        <i className="fa-solid fa-play"></i> 🎥 Video Clip Replay Loop
                                    </button>
                                </div>
                                <a
                                    href={evidenceModalEvent.clip_path || evidenceModalEvent.snapshot_path || '#'}
                                    download={`${evidenceModalEvent.event_uid || 'theft'}.mp4`}
                                    className="btn btn-sm btn-secondary"
                                    target="_blank"
                                >
                                    <i className="fa-solid fa-download"></i> Download Clip
                                </a>
                            </div>

                            {/* Evidence View Container */}
                            <div className="cctv-player-container" style={{ minHeight: '340px' }}>
                                {evidenceViewMode === 'snapshot' ? (
                                    <img
                                        src={evidenceModalEvent.snapshot_path || '/api/video_feed'}
                                        alt="Incident Snapshot"
                                        style={{ width: '100%', maxHeight: '340px', objectFit: 'contain' }}
                                    />
                                ) : (
                                    <img
                                        src={`/api/incident_replay/${(evidenceModalEvent.clip_path || '').split('/').pop()}`}
                                        alt="Video Clip Replay Loop"
                                        style={{ width: '100%', maxHeight: '340px', objectFit: 'contain' }}
                                    />
                                )}
                            </div>

                            {/* Meta Grid */}
                            <div className="d-flex justify-content-between p-2 mt-2" style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '8px', fontSize: '0.78rem' }}>
                                <div><span className="text-muted">UID:</span> <strong>{evidenceModalEvent.event_uid}</strong></div>
                                <div><span className="text-muted">Camera:</span> <strong>{evidenceModalEvent.camera_name}</strong></div>
                                <div><span className="text-muted">Confidence:</span> <strong className="text-red">{Math.round(evidenceModalEvent.confidence * 100)}%</strong></div>
                                <div><span className="text-muted">Time:</span> <strong>{evidenceModalEvent.timestamp}</strong></div>
                            </div>

                            {/* Notes */}
                            <div className="form-group mt-2">
                                <label className="font-xs text-muted">Security Review Notes</label>
                                <textarea
                                    className="form-control"
                                    rows="2"
                                    value={officerNotes}
                                    onChange={(e) => setOfficerNotes(e.target.value)}
                                    placeholder="Enter review action..."
                                />
                            </div>
                        </div>

                        <div className="panel-footer d-flex justify-content-between">
                            <div className="d-flex gap-1">
                                <button className="btn btn-sm btn-danger" onClick={() => handleUpdateIncidentStatus('CONFIRMED_THEFT')}>
                                    <i className="fa-solid fa-triangle-exclamation"></i> Confirm Theft
                                </button>
                                <button className="btn btn-sm btn-outline" onClick={() => handleUpdateIncidentStatus('FALSE_ALARM')}>
                                    <i className="fa-solid fa-ban"></i> False Alarm
                                </button>
                                <button className="btn btn-sm btn-success" onClick={() => handleUpdateIncidentStatus('RESOLVED')}>
                                    <i className="fa-solid fa-check"></i> Resolved
                                </button>
                            </div>
                            <button className="btn btn-sm btn-secondary" onClick={() => setEvidenceModalEvent(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 6. EDIT CAMERA MODAL */}
            {editCamModalData && (
                <div className="modal-overlay">
                    <div className="modal-content-box" style={{ maxWidth: '480px' }}>
                        <div className="panel-header">
                            <div className="panel-title">
                                <i className="fa-solid fa-pen-to-square text-blue"></i>
                                <span>Edit Camera Parameters</span>
                            </div>
                            <button className="btn-icon" onClick={() => setEditCamModalData(null)}>&times;</button>
                        </div>
                        <form onSubmit={handleSaveEditedCamera}>
                            <div className="panel-body">
                                <div className="form-group">
                                    <label className="font-xs">Camera Name</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={editCamModalData.name || ''}
                                        onChange={(e) => setEditCamModalData({ ...editCamModalData, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="form-group mt-2">
                                    <label className="font-xs">Camera Type</label>
                                    <select
                                        className="form-select"
                                        value={editCamModalData.camera_type || 'webcam'}
                                        onChange={(e) => setEditCamModalData({ ...editCamModalData, camera_type: e.target.value })}
                                    >
                                        <option value="webcam">Laptop / USB Webcam (0, 1)</option>
                                        <option value="mobile_ip">Mobile Phone IP Camera (HTTP Stream)</option>
                                        <option value="cctv_rtsp">Supermarket CCTV Camera (RTSP Stream)</option>
                                        <option value="demo_sim">Interactive AI Demo Simulator</option>
                                    </select>
                                </div>
                                <div className="form-group mt-2">
                                    <label className="font-xs">Source URL / Device Index</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={editCamModalData.source || ''}
                                        onChange={(e) => setEditCamModalData({ ...editCamModalData, source: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="form-group mt-2">
                                    <label className="font-xs">Store Location / Aisle</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={editCamModalData.location || ''}
                                        onChange={(e) => setEditCamModalData({ ...editCamModalData, location: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="panel-footer d-flex justify-content-between">
                                <button type="submit" className="btn btn-sm btn-primary">
                                    <i className="fa-solid fa-floppy-disk"></i> Save Changes
                                </button>
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditCamModalData(null)}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 7. SANDS LAB SUPPORT & PRODUCTS POPUP MODAL */}
            {sandsModalOpen && (
                <div className="modal-overlay" onClick={() => setSandsModalOpen(false)}>
                    <div className="modal-content-box" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="panel-header">
                            <div className="panel-title">
                                <i className="fa-solid fa-flask-vial text-blue"></i>
                                <span>Engineered By SaNDS Lab</span>
                            </div>
                            <button className="btn-icon" onClick={() => setSandsModalOpen(false)}>&times;</button>
                        </div>
                        <div className="panel-body">
                            <p className="font-sm text-secondary mb-2">
                                Intelligent AI Vision & Automation Solutions. Click any option below to connect with us directly or explore our ecosystem:
                            </p>

                            <div className="sands-actions-grid">
                                {/* 1. WhatsApp Help Button */}
                                <a
                                    href="https://wa.me/97335078079?text=Hello%20SaNDS%20Lab%2C%20I%20need%20assistance%20with%20AegisVision%20Theft%20Control"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sands-action-link"
                                >
                                    <div className="sands-icon-box sands-icon-whatsapp">
                                        <i className="fa-brands fa-whatsapp"></i>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <strong style={{ color: '#25D366' }}>Help (WhatsApp Support)</strong>
                                            <span className="badge-tag confirmed font-xs">Online</span>
                                        </div>
                                        <div className="font-xs text-muted mt-1">+973 35078079 &bull; Instant Engineer Chat</div>
                                    </div>
                                    <i className="fa-solid fa-arrow-up-right-from-square font-xs text-muted"></i>
                                </a>

                                {/* 2. Website Button */}
                                <a
                                    href="https://www.sandslab.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sands-action-link"
                                >
                                    <div className="sands-icon-box sands-icon-web">
                                        <i className="fa-solid fa-globe"></i>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <strong>Web Site</strong>
                                        <div className="font-xs text-muted mt-1">www.sandslab.com</div>
                                    </div>
                                    <i className="fa-solid fa-arrow-up-right-from-square font-xs text-muted"></i>
                                </a>

                                {/* 3. Other Products Button */}
                                <a
                                    href="https://www.sandslab.com/products"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sands-action-link"
                                >
                                    <div className="sands-icon-box sands-icon-products">
                                        <i className="fa-solid fa-layer-group"></i>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <strong>Other Products</strong>
                                        <div className="font-xs text-muted mt-1">sandslab.com/products</div>
                                    </div>
                                    <i className="fa-solid fa-arrow-up-right-from-square font-xs text-muted"></i>
                                </a>
                            </div>
                        </div>
                        <div className="panel-footer d-flex justify-content-between align-items-center">
                            <span className="font-xs text-muted">&copy; SaNDS Lab &bull; All Rights Reserved</span>
                            <button className="btn btn-sm btn-secondary" onClick={() => setSandsModalOpen(false)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// -------------------------------------------------------------
// TAB 1: DASHBOARD
// -------------------------------------------------------------
function DashboardTab({ stats, events, cameras, isArmed, streamTimestamp, onActivateCamera, onTriggerTest, onOpenEvidence, onSwitchTab }) {
    let threatText = 'NORMAL';
    let threatClass = 'text-green';
    let threatSub = 'AI Armed & Monitoring';
    if (!isArmed) {
        threatText = 'STANDBY';
        threatClass = 'text-blue';
        threatSub = 'Click "AI: Standby" in top bar to Arm';
    } else if (stats.pending_review > 3 || stats.confirmed_theft > 2) {
        threatText = 'HIGH ALERT';
        threatClass = 'text-red';
        threatSub = 'Multiple suspicious concealments detected';
    } else if (stats.pending_review > 0) {
        threatText = 'ELEVATED';
        threatClass = 'text-amber';
        threatSub = 'Pending incidents awaiting verification';
    }

    return (
        <div className="tab-content">
            {/* KPI Banner */}
            <div className="kpi-grid">
                <div className="kpi-card kpi-threat">
                    <div className="kpi-icon-wrap bg-red-grad">
                        <i className="fa-solid fa-shield-virus"></i>
                    </div>
                    <div className="kpi-info">
                        <span className="kpi-label">Threat Level</span>
                        <h3 className={`kpi-value ${threatClass}`}>{threatText}</h3>
                        <span className="kpi-sub">{threatSub}</span>
                    </div>
                </div>

                <div className="kpi-card">
                    <div className="kpi-icon-wrap bg-amber-grad">
                        <i className="fa-solid fa-bell"></i>
                    </div>
                    <div className="kpi-info">
                        <span className="kpi-label">Alarms Today</span>
                        <h3 className="kpi-value">{stats.total_today || 0}</h3>
                        <span className="kpi-sub text-amber">Real-time triggers</span>
                    </div>
                </div>

                <div className="kpi-card">
                    <div className="kpi-icon-wrap bg-blue-grad">
                        <i className="fa-solid fa-hourglass-half"></i>
                    </div>
                    <div className="kpi-info">
                        <span className="kpi-label">Pending Review</span>
                        <h3 className="kpi-value">{stats.pending_review || 0}</h3>
                        <span className="kpi-sub text-blue">Awaiting review</span>
                    </div>
                </div>

                <div className="kpi-card">
                    <div className="kpi-icon-wrap bg-green-grad">
                        <i className="fa-solid fa-circle-check"></i>
                    </div>
                    <div className="kpi-info">
                        <span className="kpi-label">Confirmed Thefts</span>
                        <h3 className="kpi-value">{stats.confirmed_theft || 0}</h3>
                        <span className="kpi-sub text-green">Escalated to floor</span>
                    </div>
                </div>

                <div className="kpi-card">
                    <div className="kpi-icon-wrap bg-purple-grad">
                        <i className="fa-solid fa-video"></i>
                    </div>
                    <div className="kpi-info">
                        <span className="kpi-label">Active Feed</span>
                        <h3 className="kpi-value font-sm">{stats.active_camera || 'Webcam'}</h3>
                        <span className="kpi-sub">FPS: {stats.fps || 0}</span>
                    </div>
                </div>
            </div>

            {/* Dashboard 2-Column */}
            <div className="dash-layout-grid">
                {/* Left: Live CCTV Feed Card */}
                <div className="panel-card">
                    <div className="panel-header">
                        <div className="panel-title">
                            <i className="fa-solid fa-camera"></i>
                            <span>Live CCTV Feed with Behavior HUD</span>
                        </div>
                        <button className="btn btn-xs btn-outline" onClick={() => onSwitchTab('live-monitor')}>
                            <i className="fa-solid fa-expand"></i> Fullscreen
                        </button>
                    </div>
                    <div className="cctv-player-container">
                        <img
                            src={`/api/video_feed?${streamTimestamp}`}
                            alt="Live CCTV"
                            className="stream-feed-img"
                        />
                        <div className="hud-live-tag">
                            <span style={{ width: '6px', height: '6px', backgroundColor: '#fff', borderRadius: '50%' }}></span>
                            LIVE
                        </div>
                        <div className="stream-hud-badges">
                            <span className="hud-badge-chip">
                                <i className="fa-solid fa-microchip text-blue"></i> AI: Vector Motion Tracking
                            </span>
                            <span className="hud-badge-chip">
                                <i className="fa-solid fa-crosshairs text-amber"></i> Trigger: Yellow Shelf &rarr; Red Pocket
                            </span>
                        </div>
                    </div>
                    <div className="panel-footer d-flex align-items-center justify-content-between">
                        <div className="d-flex align-items-center gap-1 font-xs">
                            <label className="text-muted">Camera:</label>
                            <select
                                className="form-select"
                                style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                value={(cameras.find(c => c.is_active) || {}).id || ''}
                                onChange={(e) => onActivateCamera(e.target.value)}
                            >
                                {cameras.map(c => (
                                    <option key={c.id} value={c.id}>{c.name} ({c.camera_type})</option>
                                ))}
                            </select>
                        </div>
                        <button className="btn btn-xs btn-danger" onClick={onTriggerTest}>
                            <i className="fa-solid fa-bolt"></i> Test Simulated Alarm
                        </button>
                    </div>
                </div>

                {/* Right: Real-time Incident Feed Card */}
                <div className="panel-card">
                    <div className="panel-header">
                        <div className="panel-title">
                            <i className="fa-solid fa-clock-rotate-left"></i>
                            <span>Live Incidents & Evidence</span>
                        </div>
                        <button className="btn btn-xs btn-outline" onClick={() => onSwitchTab('incidents')}>
                            View All &rarr;
                        </button>
                    </div>
                    <div className="panel-body p-0">
                        <div className="incident-scroll-feed">
                            {events.length === 0 ? (
                                <div className="text-center p-4 text-muted font-xs">
                                    <i className="fa-solid fa-shield-check" style={{ fontSize: '1.8rem' }}></i>
                                    <p className="mt-2">No theft events detected yet. Store is secure.</p>
                                </div>
                            ) : (
                                events.slice(0, 8).map(evt => (
                                    <div key={evt.id} className="incident-row-item">
                                        <div className="d-flex align-items-center gap-2">
                                            <img
                                                src={evt.snapshot_path || '/api/video_feed'}
                                                alt="Event"
                                                className="incident-thumb-img"
                                                onClick={() => onOpenEvidence(evt)}
                                            />
                                            <div>
                                                <div className="font-sm" style={{ fontWeight: 700 }}>
                                                    {formatType(evt.event_type)}
                                                </div>
                                                <div className="font-xs text-muted">
                                                    {evt.timestamp} &bull; {evt.zone_name || 'Shelf ROI'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="d-flex align-items-center gap-1">
                                            <StatusBadge status={evt.status} />
                                            <button className="btn btn-xs btn-outline" onClick={() => onOpenEvidence(evt)}>
                                                Review
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// TAB 2: LIVE MONITOR
// -------------------------------------------------------------
function LiveMonitorTab({ stats, cameras, streamTimestamp, onActivateCamera, onTriggerTest, onToggleAI }) {
    const isArmed = stats.engine_state ? stats.engine_state.detection_enabled : false;

    return (
        <div className="tab-content">
            <div className="dash-layout-grid">
                <div className="panel-card">
                    <div className="panel-header">
                        <div className="panel-title">
                            <i className="fa-solid fa-video"></i>
                            <span>High-Definition Security Stream</span>
                        </div>
                        <div className="d-flex gap-1">
                            <button
                                className={`btn btn-xs ${isArmed ? 'btn-danger' : 'btn-secondary'}`}
                                onClick={onToggleAI}
                            >
                                <i className={`fa-solid ${isArmed ? 'fa-shield-halved' : 'fa-shield'}`}></i>
                                <span>{isArmed ? 'ARMED' : 'Standby'}</span>
                            </button>
                            <button className="btn btn-xs btn-danger" onClick={onTriggerTest}>
                                <i className="fa-solid fa-bolt"></i> Test Event
                            </button>
                        </div>
                    </div>
                    <div className="cctv-player-container" style={{ minHeight: '440px' }}>
                        <img
                            src={`/api/video_feed?${streamTimestamp}`}
                            alt="CCTV Primary Stream"
                            className="stream-feed-img"
                            style={{ maxHeight: '440px' }}
                        />
                    </div>
                    <div className="panel-footer d-flex justify-content-between font-xs">
                        <div><span className="text-muted">Camera:</span> <strong>{stats.active_camera}</strong></div>
                        <div><span className="text-muted">FPS:</span> <strong>{stats.fps || 0}</strong></div>
                        <div><span className="text-muted">AI Engine:</span> <strong className="text-green">MOG2 + Heuristic Vector</strong></div>
                        <div><span className="text-muted">Ring Buffer:</span> <strong className="text-blue">90 Frames (~3.5s Pre-buffer)</strong></div>
                    </div>
                </div>

                <div className="panel-card">
                    <div className="panel-header">
                        <div className="panel-title">
                            <i className="fa-solid fa-network-wired"></i>
                            <span>Switch Feed Source</span>
                        </div>
                    </div>
                    <div className="panel-body">
                        <div className="d-flex flex-wrap gap-1">
                            {cameras.map(c => (
                                <div
                                    key={c.id}
                                    className="d-flex align-items-center justify-content-between w-100 p-2"
                                    style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px',
                                        backgroundColor: c.is_active ? 'var(--accent-blue-soft)' : 'var(--bg-primary)',
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => onActivateCamera(c.id)}
                                >
                                    <div>
                                        <strong className="font-sm">{c.name}</strong>
                                        <div className="font-xs text-muted">{c.location || 'Store'} &bull; {c.camera_type}</div>
                                    </div>
                                    <span className={`badge-tag ${c.is_active ? 'confirmed' : 'false-alarm'}`}>
                                        {c.is_active ? 'ACTIVE' : 'IDLE'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// =============================================================
// REUSABLE ADVANCED DATATABLE COMPONENT
// =============================================================
function DataTable({
    data = [],
    columns = [],
    keyField = 'id',
    defaultSortField = '',
    defaultSortDir = 'asc',
    defaultPageSize = 10,
    searchPlaceholder = 'Search records...',
    extraToolbar = null,
    emptyMessage = 'No matching records found.'
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState(defaultSortField);
    const [sortDir, setSortDir] = useState(defaultSortDir);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    // 1. Filter data by search query across all row fields
    const filteredData = React.useMemo(() => {
        if (!searchQuery.trim()) return data;
        const q = searchQuery.toLowerCase().trim();
        return data.filter(item => {
            return Object.values(item).some(val => {
                if (val === null || val === undefined) return false;
                if (typeof val === 'object') return JSON.stringify(val).toLowerCase().includes(q);
                return String(val).toLowerCase().includes(q);
            });
        });
    }, [data, searchQuery]);

    // 2. Sort filtered data
    const sortedData = React.useMemo(() => {
        if (!sortField) return filteredData;
        return [...filteredData].sort((a, b) => {
            let valA = a[sortField];
            let valB = b[sortField];
            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';

            if (typeof valA === 'number' && typeof valB === 'number') {
                return sortDir === 'asc' ? valA - valB : valB - valA;
            }
            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            if (strA < strB) return sortDir === 'asc' ? -1 : 1;
            if (strA > strB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredData, sortField, sortDir]);

    // 3. Paginate
    const totalRecords = sortedData.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const safeCurrentPage = Math.min(currentPage, totalPages);

    const paginatedData = React.useMemo(() => {
        const start = (safeCurrentPage - 1) * pageSize;
        return sortedData.slice(start, start + pageSize);
    }, [sortedData, safeCurrentPage, pageSize]);

    const handleSort = (field) => {
        if (!field) return;
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const startIdx = totalRecords === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
    const endIdx = Math.min(safeCurrentPage * pageSize, totalRecords);

    return (
        <div className="datatable-wrapper">
            {/* Toolbar: Search + Page Size + Extra Filters */}
            <div className="datatable-toolbar">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    <div className="datatable-search-box">
                        <i className="fa-solid fa-magnifying-glass"></i>
                        <input
                            type="text"
                            className="datatable-search-input"
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
                        />
                        {searchQuery && (
                            <button
                                className="btn-icon"
                                style={{ width: '22px', height: '22px', position: 'absolute', right: '6px', border: 'none', background: 'transparent' }}
                                onClick={() => setSearchQuery('')}
                                title="Clear Search"
                            >
                                <i className="fa-solid fa-xmark font-xs"></i>
                            </button>
                        )}
                    </div>
                    <div className="d-flex align-items-center gap-1 font-xs text-muted">
                        <span>Show</span>
                        <select
                            className="form-select"
                            style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                        >
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                        <span>entries</span>
                    </div>
                </div>

                {extraToolbar && (
                    <div className="d-flex align-items-center gap-1 flex-wrap">
                        {extraToolbar}
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="datatable-table-container">
                <table className="datatable-table">
                    <thead>
                        <tr>
                            {columns.map(col => {
                                const isSorted = sortField === col.key;
                                return (
                                    <th
                                        key={col.key || col.label}
                                        className={col.sortable ? 'sortable' : ''}
                                        style={{ width: col.width || 'auto', textAlign: col.align || 'left' }}
                                        onClick={() => col.sortable && handleSort(col.key)}
                                    >
                                        <div className="d-flex align-items-center" style={{ justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start' }}>
                                            <span>{col.label}</span>
                                            {col.sortable && (
                                                <span className={`sort-icon ${isSorted ? 'active' : ''}`}>
                                                    {isSorted ? (
                                                        sortDir === 'asc' ? <i className="fa-solid fa-sort-up"></i> : <i className="fa-solid fa-sort-down"></i>
                                                    ) : (
                                                        <i className="fa-solid fa-sort"></i>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                                    <i className="fa-solid fa-folder-open mb-2" style={{ fontSize: '1.8rem', display: 'block', opacity: 0.5 }}></i>
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            paginatedData.map((row, idx) => (
                                <tr key={row[keyField] || idx}>
                                    {columns.map(col => (
                                        <td key={col.key || col.label} style={{ textAlign: col.align || 'left' }}>
                                            {col.render ? col.render(row) : row[col.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer Pagination */}
            <div className="datatable-footer">
                <div>
                    Showing <strong>{startIdx}</strong> to <strong>{endIdx}</strong> of <strong>{totalRecords}</strong> entries
                    {searchQuery && <span className="text-muted"> (filtered from {data.length} total)</span>}
                </div>
                <div className="datatable-pagination">
                    <button
                        className="page-pill-btn"
                        disabled={safeCurrentPage <= 1}
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        title="Previous Page"
                    >
                        <i className="fa-solid fa-chevron-left font-xs"></i>
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                        .map((p, i, arr) => {
                            const prev = arr[i - 1];
                            return (
                                <React.Fragment key={p}>
                                    {prev && p - prev > 1 && <span className="px-1 text-muted">...</span>}
                                    <button
                                        className={`page-pill-btn ${safeCurrentPage === p ? 'active' : ''}`}
                                        onClick={() => setCurrentPage(p)}
                                    >
                                        {p}
                                    </button>
                                </React.Fragment>
                            );
                        })
                    }

                    <button
                        className="page-pill-btn"
                        disabled={safeCurrentPage >= totalPages}
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        title="Next Page"
                    >
                        <i className="fa-solid fa-chevron-right font-xs"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// TAB 3: INCIDENTS REVIEW (DATATABLE ENABLED)
// -------------------------------------------------------------
function IncidentsTab({ events, onRefresh, onClear, onOpenEvidence }) {
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [severityFilter, setSeverityFilter] = useState('ALL');

    const filtered = events.filter(e => {
        if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
        if (severityFilter !== 'ALL' && e.severity !== severityFilter) return false;
        return true;
    });

    const columns = [
        {
            key: 'event_uid',
            label: 'Event UID',
            sortable: true,
            render: (row) => <code>{row.event_uid}</code>
        },
        {
            key: 'snapshot_path',
            label: 'Snapshot',
            sortable: false,
            render: (row) => (
                <img
                    src={row.snapshot_path || '/api/video_feed'}
                    alt="Event Snapshot"
                    className="incident-thumb-img"
                    onClick={() => onOpenEvidence(row)}
                    title="Click to view full evidence & replay"
                />
            )
        },
        {
            key: 'event_type',
            label: 'Event Type',
            sortable: true,
            render: (row) => <strong>{formatType(row.event_type)}</strong>
        },
        {
            key: 'camera_name',
            label: 'Camera / Zone',
            sortable: true,
            render: (row) => (
                <div>
                    <div>{row.camera_name}</div>
                    <small className="text-muted">{row.zone_name || 'Shelf ROI'}</small>
                </div>
            )
        },
        {
            key: 'confidence',
            label: 'Confidence',
            sortable: true,
            render: (row) => <strong>{Math.round(row.confidence * 100)}%</strong>
        },
        {
            key: 'severity',
            label: 'Severity',
            sortable: true,
            render: (row) => (
                <span className={`badge-tag ${row.severity === 'CRITICAL' ? 'critical' : 'high'}`}>
                    {row.severity}
                </span>
            )
        },
        {
            key: 'timestamp',
            label: 'Timestamp',
            sortable: true,
            render: (row) => <small>{row.timestamp}</small>
        },
        {
            key: 'status',
            label: 'Status',
            sortable: true,
            render: (row) => <StatusBadge status={row.status} />
        },
        {
            key: 'action',
            label: 'Action',
            sortable: false,
            align: 'right',
            render: (row) => (
                <button className="btn btn-xs btn-primary" onClick={() => onOpenEvidence(row)}>
                    <i className="fa-solid fa-play"></i> Evidence
                </button>
            )
        }
    ];

    const extraToolbar = (
        <>
            <select
                className="form-select"
                style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
            >
                <option value="ALL">All Statuses</option>
                <option value="PENDING_REVIEW">Pending Review</option>
                <option value="CONFIRMED_THEFT">Confirmed Theft</option>
                <option value="FALSE_ALARM">False Alarm</option>
                <option value="RESOLVED">Resolved</option>
            </select>
            <select
                className="form-select"
                style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
            >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
            </select>
            <button className="btn btn-xs btn-outline" onClick={() => onRefresh()} title="Refresh Data">
                <i className="fa-solid fa-rotate"></i>
            </button>
            <button className="btn btn-xs btn-outline text-red" onClick={onClear} title="Clear All History">
                <i className="fa-solid fa-trash-can"></i> Clear History
            </button>
            <a href="/api/export_csv" className="btn btn-xs btn-secondary" title="Export CSV Report">
                <i className="fa-solid fa-file-csv"></i> Export CSV
            </a>
        </>
    );

    return (
        <div className="tab-content panel-card">
            <div className="panel-header">
                <div className="panel-title">
                    <i className="fa-solid fa-shield-halved"></i>
                    <span>Theft Incident Records & Video Evidence Vault</span>
                </div>
                <span className="badge-tag confirmed">{filtered.length} Incidents Found</span>
            </div>
            <div className="panel-body p-0">
                <DataTable
                    data={filtered}
                    columns={columns}
                    keyField="id"
                    defaultSortField="id"
                    defaultSortDir="desc"
                    defaultPageSize={10}
                    searchPlaceholder="Search UID, camera, zone, behavior type..."
                    extraToolbar={extraToolbar}
                    emptyMessage="No theft incidents match your search or filter."
                />
            </div>
        </div>
    );
}

const PRESET_OPTIONS = [
    { id: 'desk_face_clear', label: 'Laptop Desk (Face Clear)', icon: 'fa-laptop', tip: 'Avoids face area for webcam use (Recommended)' },
    { id: 'laptop_side', label: 'Left/Right Workspace', icon: 'fa-arrows-left-right', tip: 'Split shelf & pocket regions' },
    { id: 'top_down_aisle', label: 'Top-Down Aisle (CCTV)', icon: 'fa-cart-shopping', tip: 'Overhead supermarket ceiling camera' },
    { id: 'checkout_counter', label: 'Cashier Counter Belt', icon: 'fa-credit-card', tip: 'Barcode scan plane & bag drop' },
    { id: 'full_shelf_showcase', label: 'Full Showcase Rack', icon: 'fa-store', tip: 'Multi-tier retail shelf tracking' },
    { id: 'mobile_portrait', label: 'Mobile Phone Camera', icon: 'fa-mobile-screen', tip: 'Vertical / portrait phone orientation' },
    { id: 'high_value_jewelry', label: 'High-Value Glass Display', icon: 'fa-gem', tip: 'Jewelry / cosmetics case security' },
    { id: 'clear_all', label: 'Clear All Zones', icon: 'fa-trash-can', tip: 'Remove all ROIs for custom calibration' }
];

// -------------------------------------------------------------
// HELPER: EXTRACT 4-POINT POLYGON FROM ZONE COORDS
// -------------------------------------------------------------
function getPointsFromCoords(coords) {
    if (coords && Array.isArray(coords.points) && coords.points.length >= 4) {
        return coords.points.map(p => ({ x: Math.round(Number(p.x) || 0), y: Math.round(Number(p.y) || 0) }));
    }
    if (coords && coords.x !== undefined) {
        const x = Number(coords.x) || 40;
        const y = Number(coords.y) || 60;
        const w = Number(coords.width) || 220;
        const h = Number(coords.height) || 200;
        return [
            { x: x, y: y },
            { x: x + w, y: y },
            { x: x + w, y: y + h },
            { x: x, y: y + h }
        ];
    }
    return [
        { x: 40, y: 70 },
        { x: 280, y: 60 },
        { x: 290, y: 300 },
        { x: 35, y: 320 }
    ];
}

// -------------------------------------------------------------
// TAB 4: ZONE EDITOR (4-CORNER DRAGGABLE POLYGON CALIBRATION)
// -------------------------------------------------------------
function ZoneEditorTab({ zones, streamTimestamp, onApplyPreset, onSaveZone, onDeleteZone, onSwitchTab }) {
    const svgRef = useRef(null);
    const [activePreset, setActivePreset] = useState('desk_face_clear');
    const [selectedZoneId, setSelectedZoneId] = useState('new');
    const [name, setName] = useState('Left Shelf Pick Zone');
    const [type, setType] = useState('shelf_zone');
    const [sensitivity, setSensitivity] = useState(0.8);
    
    // 4 Draggable Polygon Corner Points: C1(Top-Left), C2(Top-Right), C3(Bottom-Right), C4(Bottom-Left)
    const [points, setPoints] = useState([
        { x: 30, y: 60 },
        { x: 260, y: 50 },
        { x: 270, y: 310 },
        { x: 25, y: 330 }
    ]);
    const [draggingPoint, setDraggingPoint] = useState(null); // null, 0, 1, 2, 3, or 'center'
    const [dragStartPos, setDragStartPos] = useState(null);

    // Dynamic Zone Color
    const activeColor = type === 'shelf_zone' ? '#f59e0b' : type === 'pocket_concealment_zone' ? '#ef4444' : type === 'checkout_zone' ? '#06b6d4' : '#a855f7';

    // Center point of the active polygon
    const centerPt = {
        x: Math.round((points[0].x + points[1].x + points[2].x + points[3].x) / 4),
        y: Math.round((points[0].y + points[1].y + points[2].y + points[3].y) / 4)
    };

    // When selecting an existing zone from list
    const handleSelectZone = (z) => {
        if (!z) {
            setSelectedZoneId('new');
            setName('New Angle ROI');
            setType('shelf_zone');
            setPoints([
                { x: 40, y: 70 },
                { x: 270, y: 60 },
                { x: 280, y: 300 },
                { x: 35, y: 320 }
            ]);
            setSensitivity(0.8);
            return;
        }
        setSelectedZoneId(z.id);
        setName(z.name);
        setType(z.zone_type);
        setPoints(getPointsFromCoords(z.coords));
        setSensitivity(z.sensitivity || 0.8);
    };

    // Quick Polygon Shape Templates
    const applyShapeTemplate = (templateType) => {
        if (templateType === 'left_shelf_perspective') {
            setPoints([{ x: 20, y: 50 }, { x: 240, y: 70 }, { x: 250, y: 320 }, { x: 15, y: 350 }]);
        } else if (templateType === 'right_pocket_perspective') {
            setPoints([{ x: 390, y: 220 }, { x: 620, y: 200 }, { x: 630, y: 440 }, { x: 380, y: 460 }]);
        } else if (templateType === 'top_down_trapezoid') {
            setPoints([{ x: 80, y: 50 }, { x: 560, y: 50 }, { x: 610, y: 240 }, { x: 30, y: 240 }]);
        } else if (templateType === 'cashier_scanner_plane') {
            setPoints([{ x: 240, y: 120 }, { x: 410, y: 110 }, { x: 420, y: 340 }, { x: 230, y: 350 }]);
        } else if (templateType === 'diamond_blindspot') {
            setPoints([{ x: 320, y: 100 }, { x: 480, y: 240 }, { x: 320, y: 380 }, { x: 160, y: 240 }]);
        }
    };

    // Pointer Drag Handlers (Supports Mouse and Touch directly on live stream video)
    const handleStartDrag = (target, e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.target.setPointerCapture) {
            try { e.target.setPointerCapture(e.pointerId); } catch(err){}
        }
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = 640 / rect.width;
        const scaleY = 480 / rect.height;
        const curX = Math.round((e.clientX - rect.left) * scaleX);
        const curY = Math.round((e.clientY - rect.top) * scaleY);
        
        setDraggingPoint(target);
        setDragStartPos({ x: curX, y: curY, initialPoints: points.map(p => ({ ...p })) });
    };

    const handlePointerMove = (e) => {
        if (draggingPoint === null || !dragStartPos || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = 640 / rect.width;
        const scaleY = 480 / rect.height;
        const curX = Math.max(0, Math.min(640, Math.round((e.clientX - rect.left) * scaleX)));
        const curY = Math.max(0, Math.min(480, Math.round((e.clientY - rect.top) * scaleY)));

        if (typeof draggingPoint === 'number') {
            // Move single corner handle
            setPoints(prev => {
                const next = [...prev];
                next[draggingPoint] = { x: curX, y: curY };
                return next;
            });
        } else if (draggingPoint === 'center') {
            // Translate the entire polygon
            const dx = curX - dragStartPos.x;
            const dy = curY - dragStartPos.y;
            setPoints(dragStartPos.initialPoints.map(p => ({
                x: Math.max(0, Math.min(640, p.x + dx)),
                y: Math.max(0, Math.min(480, p.y + dy))
            })));
        }
    };

    const handlePointerUp = () => {
        setDraggingPoint(null);
        setDragStartPos(null);
    };

    // Manual Coordinate Change for Corner inputs
    const handleCornerChange = (idx, axis, val) => {
        const num = Math.max(0, Math.min(axis === 'x' ? 640 : 480, parseInt(val) || 0));
        setPoints(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [axis]: num };
            return next;
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const minX = Math.min(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y));
        const maxX = Math.max(...points.map(p => p.x));
        const maxY = Math.max(...points.map(p => p.y));

        onSaveZone({
            id: selectedZoneId === 'new' ? null : selectedZoneId,
            name: name,
            zone_type: type,
            coords: {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                points: points
            },
            sensitivity: parseFloat(sensitivity)
        });
    };

    return (
        <div className="tab-content zone-calibration-grid">
            {/* Left: Interactive Live Camera View with Draggable 4-Corner Polygon */}
            <div className="panel-card">
                <div className="panel-header">
                    <div className="panel-title">
                        <i className="fa-solid fa-draw-polygon text-blue"></i>
                        <span>Live 4-Corner Polygon ROI Drag & Calibration</span>
                    </div>
                    <span className="badge-tag confirmed">
                        <i className="fa-solid fa-hand-pointer"></i> Drag Any Corner on Live Feed
                    </span>
                </div>
                
                {/* Interactive Video & SVG Overlay Container */}
                <div className="zone-interactive-container">
                    <img
                        src={`/api/video_feed?${streamTimestamp}`}
                        alt="Zone Calibration Live Feed"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    
                    <svg
                        ref={svgRef}
                        className="zone-interactive-svg"
                        viewBox="0 0 640 480"
                        preserveAspectRatio="none"
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                    >
                        {/* Background / Inactive Zones */}
                        {zones.filter(z => z.id !== selectedZoneId).map(z => {
                            const zpts = getPointsFromCoords(z.coords);
                            const zcolor = z.zone_type === 'shelf_zone' ? '#f59e0b' : z.zone_type === 'pocket_concealment_zone' ? '#ef4444' : z.zone_type === 'checkout_zone' ? '#06b6d4' : '#a855f7';
                            const polyStr = zpts.map(p => `${p.x},${p.y}`).join(' ');
                            return (
                                <g key={z.id} onClick={() => handleSelectZone(z)} style={{ cursor: 'pointer' }}>
                                    <polygon
                                        points={polyStr}
                                        fill={zcolor}
                                        fillOpacity="0.18"
                                        stroke={zcolor}
                                        strokeWidth="1.8"
                                        strokeDasharray="4 3"
                                    />
                                    <text
                                        x={zpts[0].x + 4}
                                        y={Math.max(14, zpts[0].y - 4)}
                                        fill="#ffffff"
                                        fontSize="10"
                                        fontWeight="700"
                                        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                                    >
                                        {z.name}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Active Editable Polygon */}
                        {points.length >= 4 && (
                            <g>
                                {/* Translucent Polygon Body */}
                                <polygon
                                    points={points.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill={activeColor}
                                    fillOpacity="0.28"
                                    stroke={activeColor}
                                    strokeWidth="2.5"
                                    className="zone-polygon-shape"
                                    onPointerDown={(e) => handleStartDrag('center', e)}
                                />

                                {/* Center Move Anchor Pin */}
                                <g onPointerDown={(e) => handleStartDrag('center', e)} style={{ cursor: 'move' }}>
                                    <circle cx={centerPt.x} cy={centerPt.y} r="14" fill="rgba(15,23,42,0.85)" stroke="#ffffff" strokeWidth="1.5" />
                                    <text x={centerPt.x} y={centerPt.y + 3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="800">
                                        MOVE
                                    </text>
                                </g>

                                {/* 4 Draggable Corner Handles */}
                                {points.map((p, idx) => {
                                    const cornerNames = ['C1 (Top-Left)', 'C2 (Top-Right)', 'C3 (Bottom-Right)', 'C4 (Bottom-Left)'];
                                    const isDragging = draggingPoint === idx;
                                    return (
                                        <g
                                            key={idx}
                                            className="zone-corner-pin"
                                            onPointerDown={(e) => handleStartDrag(idx, e)}
                                        >
                                            {/* Outer Glow Halo */}
                                            <circle cx={p.x} cy={p.y} r={isDragging ? 18 : 13} fill="rgba(255,255,255,0.25)" stroke={activeColor} strokeWidth="1.5" />
                                            {/* Inner Pin */}
                                            <circle cx={p.x} cy={p.y} r={isDragging ? 9 : 7.5} fill={activeColor} stroke="#ffffff" strokeWidth="2" />
                                            <text x={p.x} y={p.y + 3} textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="900">
                                                {idx + 1}
                                            </text>
                                            {/* Live Tooltip when dragging */}
                                            {isDragging && (
                                                <g>
                                                    <rect x={p.x + 12} y={p.y - 22} width="84" height="20" rx="4" fill="rgba(15,23,42,0.92)" stroke={activeColor} strokeWidth="1" />
                                                    <text x={p.x + 54} y={p.y - 8} textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="800">
                                                        C{idx + 1}: {p.x}, {p.y}
                                                    </text>
                                                </g>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                        )}
                    </svg>

                    <div className="hud-live-tag">
                        <span style={{ width: '6px', height: '6px', backgroundColor: '#fff', borderRadius: '50%' }}></span>
                        4-CORNER DRAG ACTIVE
                    </div>
                </div>

                <div className="panel-footer d-flex justify-content-between align-items-center font-xs">
                    <div className="d-flex align-items-center gap-1">
                        <span className="text-muted">Interactive ROI:</span>
                        <strong style={{ color: activeColor }}>{name}</strong>
                    </div>
                    <div className="d-flex gap-2">
                        <span style={{ color: '#f59e0b' }}><i className="fa-solid fa-circle font-xs"></i> Shelf (Yellow/Orange)</span>
                        <span style={{ color: '#ef4444' }}><i className="fa-solid fa-circle font-xs"></i> Pocket/Conceal (Red)</span>
                        <span style={{ color: '#06b6d4' }}><i className="fa-solid fa-circle font-xs"></i> Checkout (Cyan)</span>
                    </div>
                </div>
            </div>

            {/* Right: Corner Coordinates, Shape Presets & Save */}
            <div className="panel-card">
                <div className="panel-header">
                    <div className="panel-title">
                        <i className="fa-solid fa-vector-square text-blue"></i>
                        <span>Polygon Shape & Corner Coordinates</span>
                    </div>
                </div>
                <div className="panel-body">
                    {/* Quick Shape Presets */}
                    <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="font-xs font-bold text-muted">QUICK PERSPECTIVE SHAPE TEMPLATES:</span>
                    </div>
                    <div className="d-flex flex-wrap gap-1 mb-2">
                        <button className="btn btn-xs btn-outline" onClick={() => applyShapeTemplate('left_shelf_perspective')} title="Angled shelf on the left wall">
                            <i className="fa-solid fa-shapes"></i> Angled Left Shelf
                        </button>
                        <button className="btn btn-xs btn-outline" onClick={() => applyShapeTemplate('right_pocket_perspective')} title="Concealment pocket on right side">
                            <i className="fa-solid fa-shapes"></i> Angled Right Pocket
                        </button>
                        <button className="btn btn-xs btn-outline" onClick={() => applyShapeTemplate('top_down_trapezoid')} title="Top-down perspective aisle trapezoid">
                            <i className="fa-solid fa-shapes"></i> Perspective Trapezoid
                        </button>
                        <button className="btn btn-xs btn-outline" onClick={() => applyShapeTemplate('cashier_scanner_plane')} title="Cashier conveyor / barcode scanner ROI">
                            <i className="fa-solid fa-shapes"></i> Counter Plane
                        </button>
                    </div>

                    <div className="divider"></div>

                    {/* Active Zones List */}
                    <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="font-xs font-bold">Active Regions ({zones.length}):</span>
                        <button className="btn btn-xs btn-outline text-blue" onClick={() => handleSelectZone(null)}>
                            <i className="fa-solid fa-plus"></i> Add New Region
                        </button>
                    </div>
                    <div className="d-flex flex-wrap gap-1 mb-2" style={{ maxHeight: '110px', overflowY: 'auto' }}>
                        {zones.length === 0 ? (
                            <div className="w-100 text-center text-muted font-xs p-2" style={{ border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                                No zones configured. Drag corners on live camera or select a template above.
                            </div>
                        ) : (
                            zones.map(z => {
                                const isSel = selectedZoneId === z.id;
                                const zcolor = z.zone_type === 'shelf_zone' ? '#f59e0b' : z.zone_type === 'pocket_concealment_zone' ? '#ef4444' : z.zone_type === 'checkout_zone' ? '#06b6d4' : '#a855f7';
                                return (
                                    <div
                                        key={z.id}
                                        className="d-flex align-items-center justify-content-between w-100 p-1"
                                        style={{
                                            border: isSel ? `2px solid ${zcolor}` : '1px solid var(--border-color)',
                                            borderRadius: '6px',
                                            backgroundColor: isSel ? 'var(--bg-card-hover)' : 'var(--bg-primary)',
                                            fontSize: '0.75rem',
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => handleSelectZone(z)}
                                    >
                                        <div className="d-flex align-items-center gap-1">
                                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: zcolor }}></span>
                                            <div>
                                                <strong>{z.name}</strong>
                                                <div className="text-muted font-xs">
                                                    {z.zone_type} &bull; 4-Corner Polygon
                                                </div>
                                            </div>
                                        </div>
                                        <div className="d-flex gap-1" onClick={e => e.stopPropagation()}>
                                            <button className="btn btn-xs btn-outline text-blue" onClick={() => handleSelectZone(z)} title="Edit Corners">
                                                <i className="fa-solid fa-pen-ruler"></i>
                                            </button>
                                            <button className="btn btn-xs btn-outline text-red" onClick={() => onDeleteZone(z.id)} title="Delete Zone">
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <div className="divider"></div>

                    {/* Zone Parameters & 4-Corner Coordinates Readout/Editor */}
                    <form onSubmit={handleSubmit}>
                        <div className="d-flex gap-1 mb-1">
                            <div style={{ flex: 1 }}>
                                <label className="font-xs">Zone Label</label>
                                <input type="text" className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="font-xs">Behavior Role</label>
                                <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                                    <option value="shelf_zone">Shelf Pick Zone (Yellow/Orange)</option>
                                    <option value="pocket_concealment_zone">Pocket Concealment (Red)</option>
                                    <option value="checkout_zone">Checkout Scanner (Cyan)</option>
                                    <option value="blind_spot">Loitering Blindspot (Purple)</option>
                                </select>
                            </div>
                        </div>

                        {/* 4 Corner Coordinate Cards */}
                        <div className="mb-2">
                            <label className="font-xs font-bold text-muted d-block mb-1">
                                4 CORNER POSITION POINTS (DRAG ON VIDEO OR TWEAK BELOW):
                            </label>
                            <div className="corner-coord-card">
                                {points.map((p, idx) => {
                                    const cornerLabels = ['Corner 1 (Top-Left)', 'Corner 2 (Top-Right)', 'Corner 3 (Bottom-Right)', 'Corner 4 (Bottom-Left)'];
                                    return (
                                        <div key={idx} className="corner-chip">
                                            <div>
                                                <div className="d-flex align-items-center gap-1 mb-1">
                                                    <span className="corner-badge" style={{ backgroundColor: activeColor }}>C{idx + 1}</span>
                                                    <span className="font-xs text-muted">{cornerLabels[idx]}</span>
                                                </div>
                                                <div className="d-flex gap-1 align-items-center">
                                                    <span className="font-xs text-muted">X:</span>
                                                    <input
                                                        type="number"
                                                        className="form-control"
                                                        style={{ width: '60px', padding: '2px 4px', fontSize: '0.72rem' }}
                                                        value={p.x}
                                                        min="0"
                                                        max="640"
                                                        onChange={(e) => handleCornerChange(idx, 'x', e.target.value)}
                                                    />
                                                    <span className="font-xs text-muted">Y:</span>
                                                    <input
                                                        type="number"
                                                        className="form-control"
                                                        style={{ width: '60px', padding: '2px 4px', fontSize: '0.72rem' }}
                                                        value={p.y}
                                                        min="0"
                                                        max="480"
                                                        onChange={(e) => handleCornerChange(idx, 'y', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="slider-group">
                            <label>
                                <span>Detection Sensitivity Threshold</span>
                                <strong>{Math.round(sensitivity * 100)}%</strong>
                            </label>
                            <input
                                type="range"
                                min="0.4"
                                max="0.95"
                                step="0.05"
                                value={sensitivity}
                                onChange={(e) => setSensitivity(e.target.value)}
                            />
                        </div>

                        <button type="submit" className="btn btn-sm btn-primary w-100 mt-2">
                            <i className="fa-solid fa-floppy-disk"></i> {selectedZoneId === 'new' ? 'Save New Polygon Zone' : 'Save & Update Polygon Shape'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// TAB 5: CAMERA SETUP (REORGANIZED: TOP FORM/GUIDE + FULL-WIDTH TABLE)
// -------------------------------------------------------------
function CameraSetupTab({ cameras, onActivateCamera, onOpenEdit, onDeleteCamera, onRefreshCameras, onSwitchTab, showNotification }) {
    const [name, setName] = useState('');
    const [type, setType] = useState('webcam');
    const [source, setSource] = useState('0');
    const [location, setLocation] = useState('');

    const handleAddCamera = async (e) => {
        e.preventDefault();
        try {
            await fetch('/api/cameras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, camera_type: type, source, location })
            });
            setName('');
            setLocation('');
            onRefreshCameras();
            if (showNotification) showNotification('Camera device registered successfully!', 'success');
        } catch (e) {
            if (showNotification) showNotification('Error adding camera device.', 'error');
        }
    };

    return (
        <div className="tab-content">
            {/* Top 2-Column Section: Register Camera + Phone/RTSP Connection Guide */}
            <div className="setup-top-grid">
                {/* Left Card: Add & Register Camera Form */}
                <div className="panel-card">
                    <div className="panel-header">
                        <div className="panel-title">
                            <i className="fa-solid fa-circle-plus"></i>
                            <span>Register New CCTV / Webcam Feed</span>
                        </div>
                    </div>
                    <div className="panel-body">
                        <form onSubmit={handleAddCamera}>
                            <div className="form-group">
                                <label className="font-xs">Camera Name / Label</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. Cashier Counter 01, Aisle 4 Shelf"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group mt-1">
                                <label className="font-xs">Camera Stream Type</label>
                                <select
                                    className="form-select"
                                    value={type}
                                    onChange={(e) => {
                                        setType(e.target.value);
                                        if (e.target.value === 'webcam') setSource('0');
                                        else if (e.target.value === 'mobile_ip') setSource('http://192.168.1.100:8080/video');
                                        else if (e.target.value === 'cctv_rtsp') setSource('rtsp://admin:pass@192.168.1.200:554/stream');
                                        else if (e.target.value === 'demo_sim') setSource('demo');
                                    }}
                                >
                                    <option value="webcam">💻 Laptop / USB Hardware Webcam (0, 1, 2)</option>
                                    <option value="mobile_ip">📱 Mobile Phone IP Camera (HTTP Stream)</option>
                                    <option value="cctv_rtsp">📹 Supermarket CCTV Camera (RTSP Stream)</option>
                                    <option value="demo_sim">🎮 Interactive AI Demo Simulator</option>
                                </select>
                            </div>
                            <div className="form-group mt-1">
                                <label className="font-xs">Source Stream URL / Device Index</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={source}
                                    onChange={(e) => setSource(e.target.value)}
                                    placeholder="0 or http://192.168.1.x:8080/video or rtsp://..."
                                    required
                                />
                            </div>
                            <div className="form-group mt-1">
                                <label className="font-xs">Store Department / Location</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. Electronics Rack, Cashier Zone 2"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                />
                            </div>
                            <button type="submit" className="btn btn-sm btn-primary w-100 mt-2">
                                <i className="fa-solid fa-plus-circle"></i> Add & Save Camera Device
                            </button>
                        </form>
                    </div>
                </div>

                {/* Right Card: Mobile Phone & RTSP Connection Guide */}
                <div className="panel-card">
                    <div className="panel-header">
                        <div className="panel-title">
                            <i className="fa-solid fa-mobile-screen-button"></i>
                            <span>How to Connect Phone / CCTV Cameras</span>
                        </div>
                        <span className="badge-tag resolved font-xs">Wireless Wi-Fi / IP</span>
                    </div>
                    <div className="panel-body font-sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                        <div className="step-guide-card">
                            <div className="step-num-badge">1</div>
                            <div>
                                <strong>Install Free IP Camera App on Phone</strong>
                                <p className="text-muted font-xs mt-1">
                                    &bull; <strong>Android</strong>: Install <em>"IP Webcam"</em> (Pavel Khlebovich) from Google Play.<br />
                                    &bull; <strong>iPhone / iPad</strong>: Install <em>"Live-Reporter"</em> or <em>"IP Camera Lite"</em> from App Store.
                                </p>
                            </div>
                        </div>

                        <div className="step-guide-card">
                            <div className="step-num-badge">2</div>
                            <div>
                                <strong>Connect to Same Wi-Fi Network</strong>
                                <p className="text-muted font-xs mt-1">Ensure your mobile phone and PC are connected to the same Wi-Fi router or hotspot.</p>
                            </div>
                        </div>

                        <div className="step-guide-card">
                            <div className="step-num-badge">3</div>
                            <div>
                                <strong>Start Server & Copy URL</strong>
                                <p className="text-muted font-xs mt-1">
                                    Tap <em>"Start Server"</em> on your phone. It provides an IP URL like: <br />
                                    <code>http://192.168.1.15:8080/video</code>
                                </p>
                            </div>
                        </div>

                        <div className="step-guide-card">
                            <div className="step-num-badge">4</div>
                            <div>
                                <strong>CCTV RTSP Format</strong>
                                <p className="text-muted font-xs mt-1">
                                    For Hikvision/Dahua CCTV: <code>rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101</code>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Full-Width Section: Configured Cameras Network DataTable */}
            <div className="panel-card full-width-card">
                <div className="panel-header">
                    <div className="panel-title">
                        <i className="fa-solid fa-network-wired"></i>
                        <span>Configured Supermarket CCTV & Camera Network</span>
                    </div>
                    <span className="badge-tag confirmed">{cameras.length} Total Devices</span>
                </div>
                <div className="panel-body p-0">
                    <DataTable
                        data={cameras}
                        columns={[
                            {
                                key: 'name',
                                label: 'Camera Name & Department',
                                sortable: true,
                                render: (c) => (
                                    <div>
                                        <strong>{c.name}</strong>
                                        <div className="text-muted font-xs">
                                            <i className="fa-solid fa-location-dot"></i> {c.location || 'Supermarket Main Floor'}
                                        </div>
                                    </div>
                                )
                            },
                            {
                                key: 'camera_type',
                                label: 'Type',
                                sortable: true,
                                render: (c) => (
                                    <span className="badge-tag medium">
                                        {c.camera_type === 'webcam' && <i className="fa-solid fa-laptop"></i>}
                                        {c.camera_type === 'mobile_ip' && <i className="fa-solid fa-mobile-screen"></i>}
                                        {c.camera_type === 'cctv_rtsp' && <i className="fa-solid fa-video"></i>}
                                        {c.camera_type === 'demo_sim' && <i className="fa-solid fa-gamepad"></i>}
                                        {' '}{c.camera_type}
                                    </span>
                                )
                            },
                            {
                                key: 'source',
                                label: 'Stream Source / URI',
                                sortable: true,
                                render: (c) => <code>{c.source}</code>
                            },
                            {
                                key: 'is_active',
                                label: 'Hardware Status',
                                sortable: true,
                                render: (c) => (
                                    <span className={`badge-tag ${c.is_active ? 'confirmed' : 'false-alarm'}`}>
                                        {c.is_active ? '🟢 ACTIVE FEED' : '⚪ IDLE STANDBY'}
                                    </span>
                                )
                            },
                            {
                                key: 'actions',
                                label: 'Actions',
                                sortable: false,
                                align: 'right',
                                render: (c) => (
                                    <div className="d-flex gap-1 justify-content-end">
                                        <button
                                            className={`btn btn-xs ${c.is_active ? 'btn-primary' : 'btn-outline'}`}
                                            onClick={() => onActivateCamera(c.id)}
                                            title="Switch Live Feed"
                                        >
                                            <i className="fa-solid fa-play"></i> {c.is_active ? 'Streaming' : 'Switch'}
                                        </button>
                                        <button className="btn btn-xs btn-outline text-blue" onClick={() => onOpenEdit(c)} title="Edit Camera Parameters">
                                            <i className="fa-solid fa-pen-to-square"></i> Edit
                                        </button>
                                        <button className="btn btn-xs btn-outline text-red" onClick={() => onDeleteCamera(c.id)} title="Delete Camera">
                                            <i className="fa-solid fa-trash"></i> Delete
                                        </button>
                                        <button className="btn btn-xs btn-outline" onClick={() => onSwitchTab('zones')} title="Calibrate Detection Zones">
                                            <i className="fa-solid fa-crosshairs"></i> Calibrate
                                        </button>
                                    </div>
                                )
                            }
                        ]}
                        keyField="id"
                        defaultSortField="id"
                        defaultSortDir="asc"
                        defaultPageSize={10}
                        searchPlaceholder="Search camera name, source, type, location..."
                        extraToolbar={
                            <button className="btn btn-xs btn-outline" onClick={onRefreshCameras} title="Refresh Camera Network">
                                <i className="fa-solid fa-rotate"></i> Refresh Network
                            </button>
                        }
                        emptyMessage="No cameras configured. Register a new camera device above."
                    />
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// TAB 6: REPORTS & AUDIT LOGS
// -------------------------------------------------------------
function ReportsTab() {
    return (
        <div className="tab-content panel-card">
            <div className="panel-header">
                <div className="panel-title">
                    <i className="fa-solid fa-file-shield"></i>
                    <span>System Architecture & MySQL Integration</span>
                </div>
                <a href="/api/export_csv" className="btn btn-sm btn-primary">
                    <i className="fa-solid fa-download"></i> Download Audit Report (.CSV)
                </a>
            </div>
            <div className="panel-body font-sm">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <div style={{ padding: '0.8rem', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <strong>Active Database Engine (MySQL Localhost)</strong>
                        <div className="font-xs text-muted mt-1">
                            <code>theft_control_db</code> &bull; User: <code>root</code> &bull; Host: <code>localhost:3306</code>
                        </div>
                    </div>
                    <div style={{ padding: '0.8rem', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <strong>Working Files Isolation (E: Drive Protected)</strong>
                        <div className="font-xs text-muted mt-1">
                            Storage Path: <code>E:\theftcontrol\WorkingFiles\storage\</code>
                        </div>
                    </div>
                    <div style={{ padding: '0.8rem', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <strong>PHP Webhook & Query Bridge</strong>
                        <div className="font-xs text-muted mt-1">
                            Bridge Script: <code>E:\theftcontrol\WorkingFiles\php_bridge\api_theft_logger.php</code>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// TAB 7: HELP & REFERENCE MANUAL
// -------------------------------------------------------------
function HelpTab() {
    return (
        <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: '0.65rem' }}>
            <div className="panel-card" style={{ padding: '0.65rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="d-flex align-items-center gap-2">
                    <i className="fa-solid fa-circle-question text-blue" style={{ fontSize: '1.25rem' }}></i>
                    <div>
                        <strong style={{ fontSize: '0.95rem' }}>AegisVision AI Help & Technical Manual</strong>
                        <div className="text-muted font-xs">4 Behavior Roles &bull; 4-Corner Draggable ROI &bull; Dynamic Confidence &bull; RTSP Setup</div>
                    </div>
                </div>
                <div className="d-flex gap-1">
                    <a
                        href="/documentation.html"
                        target="_blank"
                        className="btn btn-xs btn-outline"
                        title="Open in Fullscreen Browser Tab"
                    >
                        <i className="fa-solid fa-arrow-up-right-from-square"></i> Open in New Tab
                    </a>
                    <button
                        className="btn btn-xs btn-primary"
                        onClick={() => {
                            const iframe = document.getElementById('help-doc-frame');
                            if (iframe && iframe.contentWindow) {
                                iframe.contentWindow.print();
                            } else {
                                window.open('/documentation.html', '_blank');
                            }
                        }}
                    >
                        <i className="fa-solid fa-print"></i> Print / Save PDF
                    </button>
                </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                <iframe
                    id="help-doc-frame"
                    src="/documentation.html"
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    title="AegisVision Help Manual"
                />
            </div>
        </div>
    );
}

// Helpers
function formatType(type) {
    switch (type) {
        case 'CONCEALMENT_DETECTED': return 'Concealment (Pocket/Bag)';
        case 'LOITERING_SUSPICIOUS': return 'Suspicious Loitering';
        case 'CHECKOUT_BYPASS': return 'Checkout Bypass / Skip';
        case 'SHELF_SWEEP': return 'Rapid Shelf Sweep';
        default: return (type || '').replace(/_/g, ' ');
    }
}

function StatusBadge({ status }) {
    switch (status) {
        case 'CONFIRMED_THEFT':
            return <span className="badge-tag confirmed"><i className="fa-solid fa-triangle-exclamation"></i> Confirmed Theft</span>;
        case 'FALSE_ALARM':
            return <span className="badge-tag false-alarm"><i className="fa-solid fa-ban"></i> False Alarm</span>;
        case 'RESOLVED':
            return <span className="badge-tag resolved"><i className="fa-solid fa-check"></i> Resolved</span>;
        default:
            return <span className="badge-tag pending"><i className="fa-solid fa-hourglass-half"></i> Pending Review</span>;
    }
}

// Render React App
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
