/**
 * GoldenEye 007 WebRTC P2P Netplay Engine (v3 - Continuous Stream & Remote Play)
 * 
 * Features:
 * - 60 FPS WebRTC Canvas & Audio Stream (Remote Play Together style)
 * - 100% Guaranteed ZERO DESYNC: Host runs the authoritative instance, streaming video/audio live
 * - Low-latency 60Hz input backchannel for Players 2, 3, and 4
 * - Automatic connection handling, touch/keyboard routing, and zero manual re-syncing needed!
 */

window.GoldenEyeNetplay = (function () {
    const STATE = {
        peer: null,
        peerId: null,
        roomId: null,
        isHost: false,
        mySlot: 1, // 1: Host, 2-4: Guests
        connections: {}, // host: { slot: conn }, guest: { host: conn }
        mediaCalls: {},
        players: { 1: { name: 'Player 1 (Host)', ping: 0 } },
        inputs: { 1: {}, 2: {}, 3: {}, 4: {} },
        localKeys: {},
        connected: false,
        pingTimer: null,
        currentPing: 0,
        hostStream: null,
        isStreaming: false
    };

    // Safely capture native Gamepad API before any monkey-patching
    const nativeGetGamepads = (function () {
        if (typeof navigator !== 'undefined') {
            if (Navigator.prototype && Navigator.prototype.getGamepads) {
                return function () {
                    try {
                        return Navigator.prototype.getGamepads.call(navigator) || [];
                    } catch (e) {
                        return [];
                    }
                };
            } else if (navigator.getGamepads) {
                const fn = navigator.getGamepads.bind(navigator);
                return function () {
                    try {
                        return fn() || [];
                    } catch (e) {
                        return [];
                    }
                };
            }
        }
        return function () { return []; };
    })();

    function getNativeGamepads() {
        return nativeGetGamepads();
    }

    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // Capture local inputs (Keyboard, Mobile Touch, Gamepads)
    function sampleLocalInput() {
        const inp = {
            stickX: 0,
            stickY: 0,
            a: false,
            b: false,
            z: false,
            l: false,
            r: false,
            start: false,
            cUp: false,
            cDown: false,
            cLeft: false,
            cRight: false,
            dUp: false,
            dDown: false,
            dLeft: false,
            dRight: false
        };

        // 1. Keyboard
        const k = STATE.localKeys;
        if (k['ArrowUp']) inp.stickY -= 1.0;
        if (k['ArrowDown']) inp.stickY += 1.0;
        if (k['ArrowLeft']) inp.stickX -= 1.0;
        if (k['ArrowRight']) inp.stickX += 1.0;

        if (k['a'] || k['A']) inp.z = true;        // Fire (Z)
        if (k['d'] || k['D']) inp.a = true;        // Open/Action (A)
        if (k['s'] || k['S']) inp.b = true;        // Reload/Weapon (B)
        if (k['q'] || k['Q']) inp.l = true;        // Aim (L)
        if (k['e'] || k['E']) inp.r = true;        // Aim (R)
        if (k['Enter']) inp.start = true;          // Start

        // C-Buttons
        if (k['i'] || k['I']) inp.cUp = true;
        if (k['k'] || k['K']) inp.cDown = true;
        if (k['j'] || k['J']) inp.cLeft = true;
        if (k['l'] || k['L']) inp.cRight = true;

        // D-Pad
        if (k['y'] || k['Y']) inp.dUp = true;
        if (k['h'] || k['H']) inp.dDown = true;
        if (k['b'] || k['B']) inp.dLeft = true;
        if (k['n'] || k['N']) inp.dRight = true;

        // 2. Mobile Touch Controls (GoldenEyeTouch HUD)
        try {
            if (window.GoldenEyeTouch) {
                const t = window.GoldenEyeTouch.getInput();
                if (t.active) {
                    if (t.stickX !== 0 || t.stickY !== 0) {
                        inp.stickX = t.stickX;
                        inp.stickY = t.stickY;
                    }
                    if (t.a) inp.a = true;
                    if (t.b) inp.b = true;
                    if (t.z) inp.z = true;
                    if (t.l) inp.l = true;
                    if (t.r) inp.r = true;
                    if (t.start) inp.start = true;
                    if (t.cLeft) inp.cLeft = true;
                    if (t.cRight) inp.cRight = true;
                    if (t.cUp) inp.cUp = true;
                    if (t.cDown) inp.cDown = true;
                }
            }
        } catch (e) {}

        // 3. Fallback N64Wasm native touch controller
        try {
            const ic = window.myApp && window.myApp.rivetsData && window.myApp.rivetsData.inputController;
            if (ic) {
                if (ic.VectorX || ic.VectorY) {
                    inp.stickX = ic.VectorX;
                    inp.stickY = ic.VectorY;
                }
                if (ic.Key_Action_A) inp.a = true;
                if (ic.Key_Action_B) inp.b = true;
                if (ic.Key_Action_Z) inp.z = true;
                if (ic.Key_Action_Start) inp.start = true;
            }
        } catch (e) {}

        // 3. Physical Gamepad API (USB / Bluetooth / Wireless / Mobile GameSir/Kishi)
        try {
            const rawPads = getNativeGamepads();
            let physicalUsed = false;
            for (let i = 0; i < rawPads.length; i++) {
                const gp = rawPads[i];
                if (gp && gp.connected && gp.buttons && gp.buttons.length > 0) {
                    const btn = (idx) => {
                        const b = gp.buttons[idx];
                        if (!b) return false;
                        return b.pressed || (typeof b.value === 'number' && b.value > 0.3);
                    };

                    let activeThisPad = false;

                    // Modern FPS mappings for Xbox / PlayStation / Switch / Mobile telescopic controllers:
                    // Action / Open Doors / Reload / Activate (N64 B Button):
                    // Button 0 = A (Xbox/Switch) or Cross (PS)
                    // Button 2 = X (Xbox/Switch) or Square (PS)
                    if (btn(0) || btn(2)) { inp.b = true; activeThisPad = true; }

                    // Change Weapon (N64 A Button):
                    // Button 1 = B (Xbox/Switch) or Circle (PS)
                    // Button 3 = Y (Xbox/Switch) or Triangle (PS)
                    if (btn(1) || btn(3)) { inp.a = true; activeThisPad = true; }

                    // Fire Weapon (N64 Z Trigger):
                    // RT (Button 7) or LB (Button 4)
                    if (btn(7) || btn(4)) { inp.z = true; activeThisPad = true; }

                    // Aim Crosshair (N64 R Shoulder Button):
                    // LT (Button 6) or RB (Button 5)
                    if (btn(6) || btn(5)) { inp.r = true; activeThisPad = true; }

                    // Start / Dossier Menu:
                    // Start (Button 9) or Select/Back (Button 8)
                    if (btn(9) || btn(8)) { inp.start = true; activeThisPad = true; }

                    // D-Pad
                    if (btn(12)) { inp.dUp = true; activeThisPad = true; }
                    if (btn(13)) { inp.dDown = true; activeThisPad = true; }
                    if (btn(14)) { inp.dLeft = true; activeThisPad = true; }
                    if (btn(15)) { inp.dRight = true; activeThisPad = true; }

                    // Left Analog Stick (Movement) with 0.15 deadzone
                    if (gp.axes && gp.axes.length >= 2) {
                        const ax = gp.axes[0];
                        const ay = gp.axes[1];
                        if (Math.abs(ax) > 0.15) { inp.stickX = ax; activeThisPad = true; }
                        if (Math.abs(ay) > 0.15) { inp.stickY = ay; activeThisPad = true; }
                    }

                    // Right Analog Stick (Look & Strafe C-Buttons)
                    let rx = 0, ry = 0;
                    if (gp.axes && gp.axes.length >= 4) {
                        if (gp.axes.length >= 6 && Math.abs(gp.axes[2]) < 0.1 && (Math.abs(gp.axes[3]) > 0.2 || Math.abs(gp.axes[4]) > 0.2)) {
                            rx = gp.axes[3];
                            ry = gp.axes[4];
                        } else {
                            rx = gp.axes[2];
                            ry = gp.axes[3];
                        }
                    }
                    if (rx < -0.35) { inp.cLeft = true; activeThisPad = true; }
                    if (rx > 0.35) { inp.cRight = true; activeThisPad = true; }
                    if (ry < -0.35) { inp.cUp = true; activeThisPad = true; }
                    if (ry > 0.35) { inp.cDown = true; activeThisPad = true; }

                    if (activeThisPad) {
                        physicalUsed = true;
                        break; // Sample primary active gamepad
                    }
                }
            }

            // Auto-hide virtual touch controls if user is actively using physical gamepad
            if (physicalUsed && window.GoldenEyeTouch && window.GoldenEyeTouch.isVisible && window.GoldenEyeTouch.isVisible()) {
                window.GoldenEyeTouch.setVisible(false);
            }
        } catch (e) {}

        return inp;
    }

    // Build synthetic Gamepad objects for SDL2 in N64Wasm
    function buildSyntheticGamepad(index, inp) {
        if (!inp) inp = {};
        const buttons = [];
        for (let i = 0; i < 16; i++) {
            buttons.push({ pressed: false, value: 0 });
        }
        const setBtn = (btnIdx, active) => {
            buttons[btnIdx] = { pressed: !!active, value: active ? 1.0 : 0.0 };
        };

        setBtn(0, inp.a);
        setBtn(2, inp.b);
        setBtn(4, inp.z);
        setBtn(6, inp.l);
        setBtn(5, inp.r);
        setBtn(9, inp.start);
        setBtn(12, inp.dUp);
        setBtn(13, inp.dDown);
        setBtn(14, inp.dLeft);
        setBtn(15, inp.dRight);

        let sX = inp.stickX || 0;
        let sY = inp.stickY || 0;
        if (sX < -1) sX = -1; if (sX > 1) sX = 1;
        if (sY < -1) sY = -1; if (sY > 1) sY = 1;

        let cX = 0, cY = 0;
        if (inp.cLeft) cX -= 1.0;
        if (inp.cRight) cX += 1.0;
        if (inp.cUp) cY -= 1.0;
        if (inp.cDown) cY += 1.0;

        return {
            id: 'Virtual N64 Netplay Gamepad ' + (index + 1),
            index: index,
            connected: true,
            timestamp: performance.now(),
            mapping: 'standard',
            axes: [sX, sY, cX, cY],
            buttons: buttons
        };
    }

    // Install Keyboard and Gamepad hooks
    function installHooks() {
        window.addEventListener('keydown', (e) => {
            STATE.localKeys[e.key] = true;
            // On guests, prevent game keys from triggering Player 1's local keyboard handler
            if (!STATE.isHost && STATE.connected) {
                const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', 's', 'S', 'q', 'Q', 'e', 'E', 'Enter', 'i', 'k', 'j', 'l'];
                if (gameKeys.includes(e.key)) {
                    e.stopImmediatePropagation();
                }
            }
        }, true);

        window.addEventListener('keyup', (e) => {
            STATE.localKeys[e.key] = false;
            if (!STATE.isHost && STATE.connected) {
                const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', 's', 'S', 'q', 'Q', 'e', 'E', 'Enter', 'i', 'k', 'j', 'l'];
                if (gameKeys.includes(e.key)) {
                    e.stopImmediatePropagation();
                }
            }
        }, true);

        if (!navigator.realGetGamepads) {
            navigator.realGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
        }

        // On Host, supply 4 gamepads (Player 1 from Host, Player 2-4 from remote peers)
        // On Guest, return real hardware controllers
        navigator.getGamepads = function () {
            if (!STATE.isHost) {
                return getNativeGamepads();
            }
            return [
                buildSyntheticGamepad(0, STATE.inputs[1]),
                buildSyntheticGamepad(1, STATE.inputs[2]),
                buildSyntheticGamepad(2, STATE.inputs[3]),
                buildSyntheticGamepad(3, STATE.inputs[4])
            ];
        };

        function dispatchVirtualGamepads() {
            if (!STATE.isHost) return;
            for (let i = 0; i < 4; i++) {
                try {
                    const pad = buildSyntheticGamepad(i, STATE.inputs[i + 1] || {});
                    let ev;
                    try {
                        ev = new GamepadEvent('gamepadconnected', { gamepad: pad });
                    } catch (e) {
                        ev = new Event('gamepadconnected');
                        ev.gamepad = pad;
                    }
                    window.dispatchEvent(ev);
                } catch (e) {}
            }
        }

        // Notify SDL2 that 4 controllers are active across boot & ROM loading
        [500, 1500, 3000, 5000, 8000, 12000].forEach(delay => {
            setTimeout(dispatchVirtualGamepads, delay);
        });

        window.addEventListener('gamepadconnected', (e) => {
            console.log('[Netplay] Gamepad connected:', e.gamepad && e.gamepad.id);
            setTimeout(dispatchVirtualGamepads, 250);
            if (window.GoldenEyeTouch && window.GoldenEyeTouch.isVisible && window.GoldenEyeTouch.isVisible()) {
                window.GoldenEyeTouch.setVisible(false);
            }
        });
    }

    // Capture Host's Canvas & Audio into a 60 FPS WebRTC Stream
    function initHostStream() {
        const canvas = document.getElementById('canvas');
        if (!canvas) {
            setTimeout(initHostStream, 500);
            return;
        }

        try {
            console.log('[Netplay] Initializing 60 FPS canvas capture stream...');
            let stream = null;
            if (canvas.captureStream) {
                stream = canvas.captureStream(60);
            } else if (canvas.mozCaptureStream) {
                stream = canvas.mozCaptureStream(60);
            }

            if (stream) {
                // Attach Host Audio to the WebRTC stream
                try {
                    if (window.myApp && window.myApp.audioContext && window.myApp.gainNode) {
                        const audioDest = window.myApp.audioContext.createMediaStreamDestination();
                        window.myApp.gainNode.connect(audioDest);
                        const aTrack = audioDest.stream.getAudioTracks()[0];
                        if (aTrack) {
                            stream.addTrack(aTrack);
                            console.log('[Netplay] Attached game audio track to stream');
                        }
                    }
                } catch (audioErr) {
                    console.warn('[Netplay] Audio stream attachment note:', audioErr);
                }

                STATE.hostStream = stream;
                STATE.isStreaming = true;
                console.log('[Netplay] Host game stream ready for broadcasting!');
            }
        } catch (e) {
            console.error('[Netplay] Could not capture canvas stream:', e);
        }
    }

    // Stream the game directly to a connected guest
    function streamGameToGuest(guestPeerId, slot) {
        if (!STATE.hostStream) {
            initHostStream();
        }

        if (STATE.hostStream && STATE.peer) {
            console.log(`[Netplay] Calling guest ${guestPeerId} (Slot ${slot}) with live game stream...`);
            const call = STATE.peer.call(guestPeerId, STATE.hostStream);
            STATE.mediaCalls[slot] = call;
            call.on('error', (err) => {
                console.error('[Netplay] Media call error:', err);
            });
        }
    }

    // On Guest: Attach the live video stream from Host
    function attachGuestStream(remoteStream) {
        console.log('[Netplay] Attaching host live game stream to Guest view...');
        let vid = document.getElementById('netplay-video');
        const canvas = document.getElementById('canvas');

        if (!vid) {
            vid = document.createElement('video');
            vid.id = 'netplay-video';
            vid.autoplay = true;
            vid.playsInline = true;
            vid.muted = false;
            vid.style = 'width:100%; max-width:640px; height:auto; display:block; margin:0 auto; background:#000; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.8);';
            canvas.parentNode.insertBefore(vid, canvas);
        }

        vid.srcObject = remoteStream;
        vid.play().then(() => {
            console.log('[Netplay] Live video playback running at 60 FPS!');
        }).catch(() => {
            // Browsers require a user click before playing audio
            document.addEventListener('click', () => { vid.play(); }, { once: true });
        });

        // Hide guest's local canvas so guest only views the live host stream
        canvas.style.display = 'none';
        vid.style.display = 'block';

        // Mute guest's local emulator audio to prevent audio echo
        try {
            if (window.myApp && window.myApp.gainNode) {
                window.myApp.gainNode.gain.value = 0;
            }
        } catch (e) {}

        showSyncProgress('🟢 Live Stream Connected');
        setTimeout(hideSyncProgress, 3000);
    }

    // Continuous 60Hz Input Loop
    function startInputLoop() {
        function loop() {
            const myInput = sampleLocalInput();
            STATE.inputs[STATE.mySlot] = myInput;

            if (STATE.connected) {
                if (STATE.isHost) {
                    // Host has all inputs ready for navigator.getGamepads()
                } else {
                    // Guest sends its live inputs to Host every frame
                    const hostConn = STATE.connections.host;
                    if (hostConn && hostConn.open) {
                        hostConn.send({
                            type: 'INPUT_GUEST',
                            slot: STATE.mySlot,
                            input: myInput
                        });
                    }
                }
            }
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    }

    // Host: Create Room
    function createRoom() {
        const code = generateRoomCode();
        STATE.roomId = code;
        STATE.isHost = true;
        STATE.mySlot = 1;
        updateUI();

        if (window.myClass && window.myClass.loadRom && window.myApp && window.myApp.rivetsData && window.myApp.rivetsData.beforeEmulatorStarted) {
            console.log('[Netplay] Auto-starting game ROM for Host...');
            window.myClass.loadRom();
        }

        initHostStream();

        const fullPeerId = 'ge007-' + code.toLowerCase();
        STATE.peer = new Peer(fullPeerId, { debug: 1 });

        STATE.peer.on('open', (id) => {
            console.log('[Netplay] Host open with Peer ID:', id);
            STATE.connected = true;
            STATE.players[1] = { name: 'Player 1 (Host - You)', ping: 0 };
            updateUI();
        });

        STATE.peer.on('connection', (conn) => {
            let assignedSlot = null;
            for (let s = 2; s <= 4; s++) {
                if (!STATE.connections[s]) {
                    assignedSlot = s;
                    break;
                }
            }

            if (!assignedSlot) {
                conn.on('open', () => {
                    conn.send({ type: 'ROOM_FULL' });
                    conn.close();
                });
                return;
            }

            STATE.connections[assignedSlot] = conn;

            conn.on('open', () => {
                console.log('[Netplay] Guest connected to slot:', assignedSlot);
                STATE.players[assignedSlot] = { name: 'Player ' + assignedSlot, ping: 0 };
                conn.send({
                    type: 'WELCOME',
                    slot: assignedSlot,
                    roomId: STATE.roomId,
                    players: STATE.players
                });
                broadcastPlayerList();
                updateUI();

                // Stream the game live to this guest
                setTimeout(() => {
                    streamGameToGuest(conn.peer, assignedSlot);
                }, 400);
            });

            conn.on('data', (data) => {
                handleHostMessage(conn, assignedSlot, data);
            });

            conn.on('close', () => {
                console.log('[Netplay] Player disconnected from slot:', assignedSlot);
                delete STATE.connections[assignedSlot];
                delete STATE.players[assignedSlot];
                if (STATE.mediaCalls[assignedSlot]) {
                    try { STATE.mediaCalls[assignedSlot].close(); } catch (e) {}
                    delete STATE.mediaCalls[assignedSlot];
                }
                STATE.inputs[assignedSlot] = {};
                broadcastPlayerList();
                updateUI();
            });
        });

        STATE.peer.on('error', (err) => {
            console.error('[Netplay] Peer error:', err);
        });
    }

    // Guest: Join Room
    function joinRoom(roomCode) {
        roomCode = roomCode.trim().toUpperCase();
        if (!roomCode) return;

        STATE.roomId = roomCode;
        STATE.isHost = false;
        updateUI();

        const topPanel = document.getElementById('topPanel');
        if (topPanel) topPanel.style.display = 'none';
        const canvasDiv = document.getElementById('canvasDiv');
        if (canvasDiv) canvasDiv.style.display = 'block';

        STATE.peer = new Peer(null, { debug: 1 });

        STATE.peer.on('open', (myId) => {
            const hostPeerId = 'ge007-' + roomCode.toLowerCase();
            console.log('[Netplay] Connecting to host:', hostPeerId);
            const conn = STATE.peer.connect(hostPeerId, { reliable: true });
            STATE.connections.host = conn;

            conn.on('open', () => {
                console.log('[Netplay] DataChannel open to host!');
                STATE.connected = true;
                startPingLoop();
                updateUI();
            });

            conn.on('data', (data) => {
                handleGuestMessage(data);
            });

            conn.on('close', () => {
                alert('Disconnected from room.');
                STATE.connected = false;
                updateUI();
            });
        });

        // Listen for live game stream from Host
        STATE.peer.on('call', (call) => {
            console.log('[Netplay] Answering live game stream from Host...');
            call.answer();
            call.on('stream', (remoteStream) => {
                attachGuestStream(remoteStream);
            });
        });

        STATE.peer.on('error', (err) => {
            console.error('[Netplay] Peer error:', err);
            alert('Could not join room: ' + err.message);
        });
    }

    function handleHostMessage(conn, slot, data) {
        if (data.type === 'INPUT_GUEST') {
            // Apply guest's live input to their designated controller port
            STATE.inputs[slot] = data.input;
        } else if (data.type === 'PING') {
            conn.send({ type: 'PONG', time: data.time });
        }
    }

    function kickSlot(slot) {
        if (!STATE.isHost) return;
        slot = parseInt(slot);
        if (slot <= 1 || slot > 4) return;
        console.log('[Netplay] Host kicking player in slot:', slot);
        const conn = STATE.connections[slot];
        if (conn) {
            try {
                conn.send({ type: 'KICKED' });
                conn.close();
            } catch (e) {}
            delete STATE.connections[slot];
        }
        if (STATE.mediaCalls[slot]) {
            try { STATE.mediaCalls[slot].close(); } catch (e) {}
            delete STATE.mediaCalls[slot];
        }
        delete STATE.players[slot];
        STATE.inputs[slot] = {};
        broadcastPlayerList();
        updateUI();
    }

    function handleGuestMessage(data) {
        if (data.type === 'WELCOME') {
            STATE.mySlot = data.slot;
            STATE.players = data.players;
            console.log('[Netplay] Assigned to slot:', STATE.mySlot);
            updateUI();
        } else if (data.type === 'PLAYERS_UPDATE') {
            STATE.players = data.players;
            updateUI();
        } else if (data.type === 'PONG') {
            STATE.currentPing = Math.round(performance.now() - data.time);
            updateUI();
        } else if (data.type === 'KICKED') {
            alert('You have been removed from the room by the host.');
            window.location.reload();
        } else if (data.type === 'ROOM_FULL') {
            alert('Room is full (max 4 players).');
        }
    }

    function broadcastPlayerList() {
        for (const slot in STATE.connections) {
            const conn = STATE.connections[slot];
            if (conn && conn.open) {
                conn.send({
                    type: 'PLAYERS_UPDATE',
                    players: STATE.players
                });
            }
        }
    }

    function startPingLoop() {
        if (STATE.pingTimer) clearInterval(STATE.pingTimer);
        STATE.pingTimer = setInterval(() => {
            const hostConn = STATE.connections.host;
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'PING', time: performance.now() });
            }
        }, 2000);
    }

    function showSyncProgress(msg) {
        let el = document.getElementById('netplay-sync-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'netplay-sync-overlay';
            el.style = 'position:fixed; top:20px; right:20px; background:#22c55e; color:#000; font-weight:700; padding:12px 20px; border-radius:10px; z-index:99999; box-shadow:0 4px 15px rgba(0,0,0,0.5); font-size:15px; transition:all 0.2s ease;';
            document.body.appendChild(el);
        }
        el.innerText = msg;
        el.style.display = 'block';
    }

    function hideSyncProgress() {
        const el = document.getElementById('netplay-sync-overlay');
        if (el) el.style.display = 'none';
    }

    function updateUI() {
        const bar = document.getElementById('netplay-bar');
        if (!bar) return;

        if (!STATE.roomId) {
            bar.innerHTML = `
                <div class="card p-3 my-2" style="background:#111; border:1px solid #ff7a59; color:#fff; border-radius:12px; max-width:720px; margin:0 auto;">
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div class="text-left">
                            <h5 class="m-0" style="color:#ffb38a; font-weight:700;">📡 GoldenEye 007 Online P2P</h5>
                        </div>
                        <div class="d-flex gap-2 mt-2 mt-sm-0">
                            <button id="btnToggleTouch" class="btn btn-outline-info btn-sm">
                                📱 Touch
                            </button>
                            <button id="btnNetplayHost" class="btn btn-warning font-weight-bold" style="background:#ff7a59; border:none; color:#09090b;">
                                🎮 Host Game
                            </button>
                            <button id="btnNetplayJoin" class="btn btn-outline-light">
                                🔗 Join Room
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.getElementById('btnNetplayHost').onclick = createRoom;
            document.getElementById('btnNetplayJoin').onclick = () => {
                const code = prompt('Enter 6-letter Room Code:');
                if (code) joinRoom(code);
            };
            if (document.getElementById('btnToggleTouch')) {
                document.getElementById('btnToggleTouch').onclick = () => window.GoldenEyeTouch && window.GoldenEyeTouch.toggle();
            }
        } else {
            const isHost = STATE.isHost;
            let playerBadges = '';
            for (let i = 1; i <= 4; i++) {
                const p = STATE.players[i];
                if (p) {
                    const isMe = (i === STATE.mySlot);
                    const kickBtn = (isHost && i > 1) 
                        ? `<button class="btn btn-sm btn-danger py-0 px-2 ml-2" style="font-size:11px; font-weight:700; line-height:1.5; border-radius:4px; vertical-align:middle;" onclick="window.GoldenEyeNetplay.kickSlot(${i})">✖ Kick</button>`
                        : '';
                    playerBadges += `
                        <span class="badge badge-success p-2 mr-2 mb-1" style="font-size:13px; background:#22c55e; display:inline-flex; align-items:center;">
                            ● Player ${i} ${isMe ? '(You)' : ''} ${kickBtn}
                        </span>
                    `;
                } else {
                    playerBadges += `
                        <span class="badge badge-secondary p-2 mr-2 mb-1" style="font-size:13px; background:#444;">
                            ○ Player ${i} (Open)
                        </span>
                    `;
                }
            }

            bar.innerHTML = `
                <div class="card p-3 my-2" style="background:#141416; border:1px solid #ff7a59; color:#fff; border-radius:12px; max-width:720px; margin:0 auto;">
                    <div class="d-flex flex-wrap align-items-center justify-content-between">
                        <div class="text-left">
                            <div class="d-flex align-items-center gap-2">
                                <span style="font-size:22px; font-weight:900; color:#ffb38a; letter-spacing:2px; font-family:monospace; user-select:all; cursor:pointer;" title="Tap to copy code" onclick="navigator.clipboard.writeText('${STATE.roomId}').then(()=>alert('Copied code: ${STATE.roomId}')).catch(()=>prompt('Room Code:', '${STATE.roomId}'))">
                                    ROOM: ${STATE.roomId} <span style="font-size:12px; color:#aaa; font-weight:normal; letter-spacing:normal;">(tap to copy)</span>
                                </span>
                                <span class="badge badge-info ml-2" style="background:#ff7a59; color:#000;">
                                    ${isHost ? 'HOST' : 'GUEST (P' + STATE.mySlot + ')'}
                                </span>
                                <span class="badge badge-dark ml-2">⚡ ${isHost ? '60 FPS Live' : STATE.currentPing + 'ms'}</span>
                            </div>
                            <div class="mt-2">
                                ${playerBadges}
                            </div>
                        </div>
                        <div class="mt-3 mt-sm-0 text-right">
                            <button id="btnToggleTouch" class="btn btn-sm btn-outline-info mr-1">
                                📱 Touch
                            </button>
                            <button class="btn btn-sm btn-warning font-weight-bold" onclick="toggleGameFullscreen()" style="background:#ff7a59; border:none; color:#000;">
                                ⛶ Full Screen
                            </button>
                        </div>
                    </div>
                </div>
            `;

            if (document.getElementById('btnToggleTouch')) {
                document.getElementById('btnToggleTouch').onclick = () => window.GoldenEyeTouch && window.GoldenEyeTouch.toggle();
            }
        }
    }

    function checkURLForRoom() {
        let code = null;
        const hash = window.location.hash;
        if (hash.includes('room=')) {
            code = hash.split('room=')[1].split('&')[0];
        } else {
            const params = new URLSearchParams(window.location.search);
            code = params.get('room');
        }

        if (code) {
            console.log('[Netplay] Auto-joining room from URL:', code);
            setTimeout(() => {
                joinRoom(code);
            }, 1000);
        }
    }

    function init() {
        installHooks();
        startInputLoop();
        updateUI();
        checkURLForRoom();
    }

    return {
        init: init,
        createRoom: createRoom,
        joinRoom: joinRoom,
        kickSlot: kickSlot,
        getState: () => STATE
    };
})();
