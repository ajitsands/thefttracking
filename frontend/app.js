/**
 * AegisVision - Supermarket AI CCTV Theft Control & Prevention
 * Frontend Application Logic
 */

let soundEnabled = true;
let currentTheme = localStorage.getItem('theftcontrol_theme') || 'light';
let lastSeenEventId = 0;
let activeEventForModal = null;
let currentZones = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme);
    setupNavTabs();
    setupControls();
    
    // Initial data fetch
    fetchStats();
    loadEvents();
    loadCameras();
    loadZones();
    
    // Polling intervals for real-time monitoring
    setInterval(fetchStats, 1500);
    setInterval(checkForNewEvents, 2000);
});

// ==========================================
// 1. THEME & NAVIGATION
// ==========================================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.innerHTML = theme === 'dark' 
            ? '<i class="fa-solid fa-sun text-amber"></i>' 
            : '<i class="fa-solid fa-moon"></i>';
    }
    localStorage.setItem('theftcontrol_theme', theme);
}

function setupControls() {
    // Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            currentTheme = currentTheme === 'light' ? 'dark' : 'light';
            applyTheme(currentTheme);
        });
    }

    // Sound toggle
    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            soundBtn.innerHTML = soundEnabled 
                ? '<i class="fa-solid fa-volume-high"></i>' 
                : '<i class="fa-solid fa-volume-xmark text-muted"></i>';
        });
    }

    // Sensitivity Slider live text
    const sensSlider = document.getElementById('sensitivitySlider');
    const sensText = document.getElementById('sensitivityText');
    if (sensSlider && sensText) {
        sensSlider.addEventListener('input', (e) => {
            sensText.textContent = `${Math.round(e.target.value * 100)}%`;
        });
    }

    // Loiter Slider live text
    const loiterSlider = document.getElementById('loiterSlider');
    const loiterText = document.getElementById('loiterText');
    if (loiterSlider && loiterText) {
        loiterSlider.addEventListener('input', (e) => {
            loiterText.textContent = `${e.target.value}s`;
        });
    }
}

function setupNavTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });
}

function switchTab(tabId) {
    // Update nav buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
}

// ==========================================
// 2. AUDIO CHIME ALARM (Web Audio API)
// ==========================================
function playAlertChime() {
    if (!soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // High tone
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        osc1.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
        gain1.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start();
        osc1.stop(audioCtx.currentTime + 0.35);

        // Second burst
        setTimeout(() => {
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(980, audioCtx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(520, audioCtx.currentTime + 0.25);
            gain2.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
            
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.start();
            osc2.stop(audioCtx.currentTime + 0.3);
        }, 150);
    } catch (e) {
        console.warn('Audio alert error:', e);
    }
}

// ==========================================
// 3. STATS & SYSTEM METRICS
// ==========================================
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('statTotalToday').textContent = data.total_today || 0;
        document.getElementById('statPending').textContent = data.pending_review || 0;
        document.getElementById('statConfirmed').textContent = data.confirmed_theft || 0;
        document.getElementById('statActiveCamera').textContent = data.active_camera || 'Laptop Webcam';
        document.getElementById('statFPS').textContent = `FPS: ${data.fps || 0}`;
        document.getElementById('pendingReviewBadge').textContent = data.pending_review || 0;

        // Update AI Arming button state
        const isArmed = data.engine_state ? data.engine_state.detection_enabled : false;
        const aiArmBtn = document.getElementById('aiArmBtn');
        const aiArmText = document.getElementById('aiArmText');
        if (aiArmBtn && aiArmText) {
            if (isArmed) {
                aiArmBtn.className = 'btn btn-sm btn-danger';
                aiArmBtn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> <span>AI: ARMED (REC)</span>';
            } else {
                aiArmBtn.className = 'btn btn-sm btn-secondary';
                aiArmBtn.innerHTML = '<i class="fa-solid fa-shield"></i> <span>AI: Standby (Preview)</span>';
            }
        }

        // Monitor stats
        const sensValEl = document.getElementById('monitorSensitivityVal');
        if (sensValEl && data.engine_state) {
            sensValEl.textContent = `${Math.round(data.engine_state.sensitivity * 100)}%`;
        }
        const loiterValEl = document.getElementById('monitorLoiterVal');
        if (loiterValEl && data.engine_state) {
            loiterValEl.textContent = `${data.engine_state.loitering_threshold}s`;
        }

        // Threat level determination
        const threatLevelEl = document.getElementById('storeThreatLevel');
        const threatSubEl = document.getElementById('threatSubText');
        if (threatLevelEl) {
            if (!isArmed) {
                threatLevelEl.textContent = 'STANDBY';
                threatLevelEl.className = 'stat-val threat-status-text text-blue';
                threatSubEl.textContent = 'Preview active (Click "AI: Standby" in top bar to Arm)';
            } else if (data.pending_review > 3 || data.confirmed_theft > 2) {
                threatLevelEl.textContent = 'HIGH ALERT';
                threatLevelEl.className = 'stat-val threat-status-text text-red';
                threatSubEl.textContent = 'Suspicious concealment activity detected';
            } else if (data.pending_review > 0) {
                threatLevelEl.textContent = 'ELEVATED';
                threatLevelEl.className = 'stat-val threat-status-text text-amber';
                threatSubEl.textContent = 'Pending incidents awaiting verification';
            } else {
                threatLevelEl.textContent = 'NORMAL';
                threatLevelEl.className = 'stat-val threat-status-text text-green';
                threatSubEl.textContent = 'AI Armed & Monitoring zones';
            }
        }
    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

async function toggleCameraPower() {
    const btn = document.getElementById('cameraPowerBtn');
    const text = document.getElementById('cameraPowerText');
    try {
        const res = await fetch('/api/toggle_camera', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
            if (data.camera_on) {
                if (btn) btn.className = 'btn btn-sm btn-outline';
                if (text) text.textContent = 'Cam: ON';
            } else {
                if (btn) btn.className = 'btn btn-sm btn-danger';
                if (text) text.textContent = 'Cam: OFF';
            }
            // Refresh video streams immediately
            const ts = Date.now();
            document.querySelectorAll('.cctv-stream-feed, .cctv-full-feed, .zone-bg-img').forEach(img => {
                img.src = '/api/video_feed?' + ts;
            });
            fetchStats();
        }
    } catch (e) {
        alert('Server is offline. Please launch "run_theft_control.bat" first.');
        console.error('Error toggling camera:', e);
    }
}

async function toggleAIArming() {
    const aiArmBtn = document.getElementById('aiArmBtn');
    try {
        const res = await fetch('/api/toggle_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
            if (data.armed) {
                if (aiArmBtn) {
                    aiArmBtn.className = 'btn btn-sm btn-danger';
                    aiArmBtn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> <span>AI: ARMED (REC)</span>';
                }
            } else {
                if (aiArmBtn) {
                    aiArmBtn.className = 'btn btn-sm btn-secondary';
                    aiArmBtn.innerHTML = '<i class="fa-solid fa-shield"></i> <span>AI: Standby (Preview)</span>';
                }
            }
            fetchStats();
        }
    } catch (e) {
        alert('Server is offline. Please launch "run_theft_control.bat" first.');
        console.error('Error toggling AI arming:', e);
    }
}

async function clearAllEvents() {
    if (!confirm('Clear all past theft events and logs?')) return;
    try {
        await fetch('/api/clear_events', { method: 'POST' });
        loadEvents();
        fetchStats();
    } catch (e) {
        console.error('Error clearing events:', e);
    }
}

// ==========================================
// 4. INCIDENT EVENTS & EVIDENCE REVIEW
// ==========================================
async function loadEvents() {
    try {
        const status = document.getElementById('filterStatus') ? document.getElementById('filterStatus').value : 'ALL';
        const severity = document.getElementById('filterSeverity') ? document.getElementById('filterSeverity').value : 'ALL';
        
        const res = await fetch(`/api/events?status=${status}&severity=${severity}&limit=40`);
        const data = await res.json();
        const events = data.events || [];

        renderDashboardEvents(events.slice(0, 8));
        renderIncidentsTable(events);

        if (events.length > 0 && lastSeenEventId === 0) {
            lastSeenEventId = events[0].id;
        }
    } catch (err) {
        console.error('Error loading events:', err);
    }
}

function renderDashboardEvents(events) {
    const listEl = document.getElementById('dashboardIncidentList');
    if (!listEl) return;

    if (events.length === 0) {
        listEl.innerHTML = `
            <div class="text-center p-4 text-muted">
                <i class="fa-solid fa-shield-check font-lg"></i>
                <p class="mt-2 font-sm">No recent theft incidents detected. Store is secure.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = events.map(evt => {
        const badgeClass = evt.severity === 'CRITICAL' ? 'badge-critical' : 'badge-high';
        const statusBadge = getStatusBadge(evt.status);
        const thumbSrc = evt.snapshot_path ? evt.snapshot_path : '/api/video_feed';

        return `
            <div class="incident-item">
                <div class="incident-item-left">
                    <img src="${thumbSrc}" class="incident-thumb" alt="Event frame">
                    <div>
                        <div class="incident-meta-title">
                            ${formatEventType(evt.event_type)}
                            <span class="badge ${badgeClass} ml-1">${evt.severity}</span>
                        </div>
                        <div class="incident-meta-sub">
                            <i class="fa-solid fa-clock"></i> ${evt.timestamp} &bull; ${evt.zone_name || 'Shelf Zone'}
                        </div>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    ${statusBadge}
                    <button class="btn btn-sm btn-outline" onclick="openVideoModal(${evt.id})">
                        <i class="fa-solid fa-play"></i> Review
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderIncidentsTable(events) {
    const tbody = document.getElementById('incidentsTableBody');
    if (!tbody) return;

    if (events.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center p-4 text-muted">
                    No theft incidents match your filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = events.map(evt => {
        const thumbSrc = evt.snapshot_path ? evt.snapshot_path : '/api/video_feed';
        const badgeClass = evt.severity === 'CRITICAL' ? 'badge-critical' : (evt.severity === 'HIGH' ? 'badge-high' : 'badge-medium');
        const statusBadge = getStatusBadge(evt.status);

        return `
            <tr>
                <td><code>${evt.event_uid || evt.id}</code></td>
                <td>
                    <img src="${thumbSrc}" style="width: 50px; height: 38px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-color); cursor: pointer;" onclick="openVideoModal(${evt.id})">
                </td>
                <td><strong>${formatEventType(evt.event_type)}</strong></td>
                <td>${evt.camera_name}<br><small class="text-muted">${evt.zone_name || 'Shelf Area'}</small></td>
                <td><strong>${Math.round(evt.confidence * 100)}%</strong></td>
                <td><span class="badge ${badgeClass}">${evt.severity}</span></td>
                <td><small>${evt.timestamp}</small></td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="openVideoModal(${evt.id})">
                        <i class="fa-solid fa-circle-play"></i> Evidence
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function formatEventType(type) {
    switch (type) {
        case 'CONCEALMENT_DETECTED': return 'Concealment (Pocket/Bag)';
        case 'LOITERING_SUSPICIOUS': return 'Suspicious Loitering';
        case 'CHECKOUT_BYPASS': return 'Checkout Bypass / Skip';
        case 'SHELF_SWEEP': return 'Rapid Shelf Sweep';
        default: return type.replace(/_/g, ' ');
    }
}

function getStatusBadge(status) {
    switch (status) {
        case 'CONFIRMED_THEFT':
            return `<span class="badge badge-confirmed"><i class="fa-solid fa-triangle-exclamation"></i> Confirmed Theft</span>`;
        case 'FALSE_ALARM':
            return `<span class="badge badge-false"><i class="fa-solid fa-ban"></i> False Alarm</span>`;
        case 'RESOLVED':
            return `<span class="badge badge-resolved"><i class="fa-solid fa-check"></i> Resolved</span>`;
        default:
            return `<span class="badge badge-pending"><i class="fa-solid fa-hourglass-half"></i> Pending Review</span>`;
    }
}

// Check for new real-time events and pop toaster + play sound
async function checkForNewEvents() {
    try {
        const res = await fetch('/api/events?limit=1');
        const data = await res.json();
        const latest = (data.events && data.events.length > 0) ? data.events[0] : null;

        if (latest && latest.id > lastSeenEventId) {
            lastSeenEventId = latest.id;
            triggerAlertToast(latest);
            playAlertChime();
            loadEvents();
            fetchStats();
        }
    } catch (e) {
        // silent error handling
    }
}

function triggerAlertToast(evt) {
    const container = document.getElementById('alertToastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'theft-toast';
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">🚨 THEFT ALERT: ${formatEventType(evt.event_type)}</div>
            <div class="toast-msg">${evt.camera_name} &bull; ${evt.zone_name || 'Shelf ROI'} (Conf: ${Math.round(evt.confidence * 100)}%)</div>
            <div class="toast-actions">
                <button class="btn btn-sm btn-danger" onclick="openVideoModal(${evt.id})">Review Clip</button>
                <button class="btn btn-sm btn-secondary" onclick="this.closest('.theft-toast').remove()">Dismiss</button>
            </div>
        </div>
    `;

    container.prepend(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 8000);
}

// ==========================================
// 5. VIDEO EVIDENCE MODAL & INCIDENT UPDATE
// ==========================================
async function openVideoModal(eventId) {
    try {
        const res = await fetch(`/api/events?limit=100`);
        const data = await res.json();
        const event = data.events.find(e => e.id === eventId);
        if (!event) return;

        activeEventForModal = event;

        document.getElementById('modalEventTitle').textContent = `Evidence: ${formatEventType(event.event_type)}`;
        document.getElementById('modalUid').textContent = event.event_uid || event.id;
        document.getElementById('modalCam').textContent = event.camera_name;
        document.getElementById('modalConf').textContent = `${Math.round(event.confidence * 100)}%`;
        document.getElementById('modalTime').textContent = event.timestamp;
        document.getElementById('modalNotesInput').value = event.notes || '';

        // Configure download button
        const dlBtn = document.getElementById('downloadEvidenceBtn');
        if (dlBtn) {
            dlBtn.href = event.clip_path || event.snapshot_path || '#';
            dlBtn.download = `${event.event_uid || 'theft_incident'}.mp4`;
        }

        // Configure snapshot image
        const snapshotImg = document.getElementById('incidentSnapshotViewer');
        const snapshotSrc = event.snapshot_path ? event.snapshot_path : '/api/video_feed';
        snapshotImg.src = snapshotSrc;

        // Configure video replay stream
        const replayImg = document.getElementById('incidentReplayStreamViewer');
        if (event.clip_path) {
            const filename = event.clip_path.split('/').pop();
            replayImg.src = `/api/incident_replay/${filename}`;
        } else {
            replayImg.src = snapshotSrc;
        }

        // Default to Snapshot view initially for instant crystal-clear rendering
        switchEvidenceView('snapshot');

        document.getElementById('videoModal').classList.add('active');
    } catch (e) {
        console.error('Error opening video modal:', e);
    }
}

function switchEvidenceView(viewType) {
    const snapshotImg = document.getElementById('incidentSnapshotViewer');
    const replayImg = document.getElementById('incidentReplayStreamViewer');
    const videoPlayer = document.getElementById('incidentVideoPlayer');
    const tabSnap = document.getElementById('tabSnapshotBtn');
    const tabVid = document.getElementById('tabVideoBtn');

    if (viewType === 'snapshot') {
        if (snapshotImg) snapshotImg.style.display = 'block';
        if (replayImg) replayImg.style.display = 'none';
        if (videoPlayer) videoPlayer.style.display = 'none';
        if (tabSnap) tabSnap.className = 'btn btn-sm btn-primary';
        if (tabVid) tabVid.className = 'btn btn-sm btn-outline';
    } else if (viewType === 'video') {
        if (snapshotImg) snapshotImg.style.display = 'none';
        if (replayImg) replayImg.style.display = 'block';
        if (videoPlayer) videoPlayer.style.display = 'none';
        if (tabSnap) tabSnap.className = 'btn btn-sm btn-outline';
        if (tabVid) tabVid.className = 'btn btn-sm btn-primary';
    }
}

function closeVideoModal() {
    const replayImg = document.getElementById('incidentReplayStreamViewer');
    if (replayImg) replayImg.src = '';
    const videoPlayer = document.getElementById('incidentVideoPlayer');
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.src = '';
    }
    document.getElementById('videoModal').classList.remove('active');
    activeEventForModal = null;
}

async function updateIncidentStatus(newStatus) {
    if (!activeEventForModal) return;

    const notes = document.getElementById('modalNotesInput').value;

    try {
        const res = await fetch(`/api/events/${activeEventForModal.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: newStatus,
                notes: notes,
                reviewer: 'Security Duty Officer'
            })
        });

        const data = await res.json();
        if (data.success) {
            closeVideoModal();
            loadEvents();
            fetchStats();
        }
    } catch (e) {
        console.error('Error updating status:', e);
    }
}

// ==========================================
// 6. CAMERA & FEED MANAGEMENT
// ==========================================
async function loadCameras() {
    try {
        const res = await fetch('/api/cameras');
        const data = await res.json();
        const cameras = data.cameras || [];

        // Populate Quick Select
        const quickSelect = document.getElementById('quickCameraSelect');
        if (quickSelect) {
            quickSelect.innerHTML = cameras.map(c => `
                <option value="${c.id}" ${c.is_active ? 'selected' : ''}>${c.name} (${c.camera_type})</option>
            `).join('');

            quickSelect.onchange = (e) => {
                activateCamera(e.target.value);
            };
        }

        // Populate Monitor Sidebar Pills
        const pillsList = document.getElementById('cameraPillsList');
        if (pillsList) {
            pillsList.innerHTML = cameras.map(c => `
                <div class="cam-pill-item ${c.is_active ? 'active' : ''}" onclick="activateCamera(${c.id})">
                    <div>
                        <strong>${c.name}</strong>
                        <div class="font-xs text-muted">${c.location || 'Supermarket'} &bull; ${c.camera_type}</div>
                    </div>
                    <span class="badge ${c.is_active ? 'badge-confirmed' : 'badge-false'}">
                        ${c.is_active ? 'ACTIVE' : 'STANDBY'}
                    </span>
                </div>
            `).join('');
        }

        // Populate Cameras Table in Setup Tab
        const tbody = document.getElementById('camerasTableBody');
        if (tbody) {
            tbody.innerHTML = cameras.map(c => `
                <tr>
                    <td><strong>${c.name}</strong><br><small class="text-muted">${c.location || 'Store'}</small></td>
                    <td><code>${c.camera_type}</code></td>
                    <td><code>${c.source}</code></td>
                    <td>
                        <span class="badge ${c.is_active ? 'badge-confirmed' : 'badge-false'}">
                            ${c.is_active ? 'ACTIVE' : 'IDLE'}
                        </span>
                    </td>
                    <td>
                        <div class="d-flex align-items-center gap-1">
                            <button class="btn btn-sm btn-outline" title="Switch to this Camera" onclick="activateCamera(${c.id})">
                                <i class="fa-solid fa-play"></i> Switch
                            </button>
                            <button class="btn btn-sm btn-outline text-blue" title="Edit Parameters" onclick="openEditCameraModal(${c.id})">
                                <i class="fa-solid fa-pen-to-square"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-outline text-red" title="Delete Camera" onclick="deleteCamera(${c.id})">
                                <i class="fa-solid fa-trash"></i> Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    } catch (e) {
        console.error('Error loading cameras:', e);
    }
}

let allLoadedCameras = [];

async function openEditCameraModal(camId) {
    try {
        const res = await fetch('/api/cameras');
        const data = await res.json();
        const cam = (data.cameras || []).find(c => c.id === camId);
        if (!cam) return;

        document.getElementById('editCamId').value = cam.id;
        document.getElementById('editCamName').value = cam.name;
        document.getElementById('editCamType').value = cam.camera_type;
        document.getElementById('editCamSource').value = cam.source;
        document.getElementById('editCamLocation').value = cam.location || '';

        document.getElementById('editCameraModal').classList.add('active');
    } catch (e) {
        console.error('Error opening camera edit modal:', e);
    }
}

function closeEditCameraModal() {
    const modal = document.getElementById('editCameraModal');
    if (modal) modal.classList.remove('active');
}

async function saveEditedCamera() {
    const id = document.getElementById('editCamId').value;
    const name = document.getElementById('editCamName').value;
    const type = document.getElementById('editCamType').value;
    const source = document.getElementById('editCamSource').value;
    const location = document.getElementById('editCamLocation').value;

    if (!name || !source) {
        alert('Please provide Camera Name and Source URL/Index.');
        return;
    }

    try {
        const res = await fetch(`/api/cameras/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                camera_type: type,
                source: source,
                location: location
            })
        });
        const data = await res.json();
        if (data.success) {
            closeEditCameraModal();
            loadCameras();
            fetchStats();
            // Refresh video streams
            const ts = Date.now();
            document.querySelectorAll('.cctv-stream-feed, .cctv-full-feed, .zone-bg-img').forEach(img => {
                img.src = '/api/video_feed?' + ts;
            });
            alert('Camera parameters updated successfully!');
        }
    } catch (e) {
        console.error('Error updating camera:', e);
    }
}

async function deleteCamera(camId) {
    if (!confirm('Are you sure you want to delete this camera from the system?')) return;
    try {
        const res = await fetch(`/api/cameras/${camId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadCameras();
            fetchStats();
            const ts = Date.now();
            document.querySelectorAll('.cctv-stream-feed, .cctv-full-feed, .zone-bg-img').forEach(img => {
                img.src = '/api/video_feed?' + ts;
            });
            alert('Camera deleted successfully.');
        }
    } catch (e) {
        console.error('Error deleting camera:', e);
    }
}

async function activateCamera(camId) {
    try {
        const res = await fetch(`/api/cameras/${camId}/activate`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            loadCameras();
            fetchStats();
            // Refresh video streams
            const dashImg = document.getElementById('dashboardStreamImg');
            if (dashImg) dashImg.src = '/api/video_feed?' + Date.now();
        }
    } catch (e) {
        console.error('Error activating camera:', e);
    }
}

function handleCamTypeChange() {
    const type = document.getElementById('camTypeSelect').value;
    const sourceInput = document.getElementById('camSourceInput');
    const hint = document.getElementById('camSourceHint');

    if (type === 'webcam') {
        sourceInput.value = '0';
        hint.textContent = 'Device Index: 0 for Laptop built-in webcam, 1 for external USB camera.';
    } else if (type === 'mobile_ip') {
        sourceInput.value = 'http://192.168.1.100:8080/video';
        hint.textContent = 'Enter the HTTP video URL provided by "IP Webcam" app on your mobile phone.';
    } else if (type === 'cctv_rtsp') {
        sourceInput.value = 'rtsp://admin:password@192.168.1.200:554/stream';
        hint.textContent = 'Enter RTSP stream URL of your supermarket CCTV DVR/NVR.';
    } else if (type === 'demo_sim') {
        sourceInput.value = 'demo';
        hint.textContent = 'Simulates supermarket aisle with animated shelf picking and concealment behavior.';
    }
}

async function handleNewCamera(e) {
    e.preventDefault();
    const name = document.getElementById('camNameInput').value;
    const type = document.getElementById('camTypeSelect').value;
    const source = document.getElementById('camSourceInput').value;
    const location = document.getElementById('camLocationInput').value;

    try {
        const res = await fetch('/api/cameras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                camera_type: type,
                source: source,
                location: location
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('Camera registered successfully!');
            document.getElementById('addCameraForm').reset();
            loadCameras();
        }
    } catch (err) {
        console.error('Error adding camera:', err);
    }
}

// ==========================================
// 7. ZONE & ROI MANAGEMENT
// ==========================================
async function loadZones() {
    try {
        const res = await fetch('/api/zones');
        const data = await res.json();
        currentZones = data.zones || [];

        const listContainer = document.getElementById('zoneListContainer');
        if (listContainer) {
            listContainer.innerHTML = currentZones.map(z => `
                <div class="zone-card-item">
                    <div>
                        <strong>${z.name}</strong>
                        <div class="font-xs text-muted">Type: ${z.zone_type} &bull; Sensitivity: ${Math.round((z.sensitivity || 0.75) * 100)}%</div>
                    </div>
                    <button class="btn btn-sm btn-outline text-red" onclick="deleteZone(${z.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('Error loading zones:', e);
    }
}

async function applyZonePreset(presetName) {
    try {
        const res = await fetch('/api/zones/preset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset: presetName })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Preset '${presetName}' calibrated successfully!`);
            loadZones();
            // Refresh video streams
            const ts = Date.now();
            document.querySelectorAll('.cctv-stream-feed, .cctv-full-feed, .zone-bg-img').forEach(img => {
                img.src = '/api/video_feed?' + ts;
            });
        }
    } catch (e) {
        console.error('Error applying zone preset:', e);
    }
}

async function saveNewZone() {
    const name = document.getElementById('newZoneName').value || 'New Shelf ROI';
    const type = document.getElementById('newZoneType').value;
    const x = parseInt(document.getElementById('newZoneX').value, 10);
    const y = parseInt(document.getElementById('newZoneY').value, 10);
    const width = parseInt(document.getElementById('newZoneW').value, 10);
    const height = parseInt(document.getElementById('newZoneH').value, 10);

    try {
        const res = await fetch('/api/zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                zone_type: type,
                coords: { x, y, width, height },
                sensitivity: 0.8
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('Zone saved and calibrated into AI detection engine!');
            loadZones();
        }
    } catch (e) {
        console.error('Error saving zone:', e);
    }
}

async function deleteZone(zoneId) {
    if (!confirm('Are you sure you want to delete this detection zone?')) return;
    try {
        await fetch(`/api/zones/${zoneId}`, { method: 'DELETE' });
        loadZones();
    } catch (e) {
        console.error('Error deleting zone:', e);
    }
}

// ==========================================
// 8. AI CALIBRATION & TEST TRIGGERS
// ==========================================
async function triggerTestAlarm() {
    try {
        const res = await fetch('/api/trigger_test_alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: 'CONCEALMENT_DETECTED',
                confidence: 0.94,
                severity: 'CRITICAL',
                zone: 'Cosmetics Shelf Aisle 3'
            })
        });
        const data = await res.json();
        if (data.success) {
            checkForNewEvents();
        }
    } catch (e) {
        console.error('Error triggering test alarm:', e);
    }
}

async function saveAISettings() {
    const sensitivity = parseFloat(document.getElementById('sensitivitySlider').value);
    const loitering = parseFloat(document.getElementById('loiterSlider').value);

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sensitivity: sensitivity,
                loitering_threshold: loitering
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('AI Calibration saved successfully!');
            fetchStats();
        }
    } catch (e) {
        console.error('Error saving settings:', e);
    }
}

async function toggleOverlays() {
    try {
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();
        const currentOverlay = stats.engine_state ? stats.engine_state.show_overlays : true;

        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                show_overlays: !currentOverlay
            })
        });
    } catch (e) {
        console.error('Error toggling overlays:', e);
    }
}
