/**
 * GoldenEye 007 Modern Touch HUD & Audio Unmute Manager
 * Ergonomic floating controls for mobile Safari (iOS) and Android Chrome.
 */

window.GoldenEyeTouch = (function () {
    const STATE = {
        enabled: false,
        active: false,
        stickX: 0,
        stickY: 0,
        a: false,
        b: false,
        z: false,
        l: false,
        r: false,
        start: false,
        cLeft: false,
        cRight: false,
        cUp: false,
        cDown: false,
        joystickManager: null
    };

    function isTouchDevice() {
        return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 850);
    }

    function vibrate(ms) {
        try {
            if (navigator.vibrate) navigator.vibrate(ms || 15);
        } catch (e) {}
    }

    function createHUD() {
        if (document.getElementById('goldeneye-touch-hud')) return;

        const hud = document.createElement('div');
        hud.id = 'goldeneye-touch-hud';
        hud.innerHTML = `
            <style>
                #goldeneye-touch-hud {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    pointer-events: none;
                    z-index: 99998;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: none;
                    display: none;
                }
                .ge-touch-zone {
                    position: absolute;
                    bottom: 25px;
                    left: 20px;
                    width: 150px;
                    height: 150px;
                    pointer-events: auto;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.05);
                    border: 2px dashed rgba(255, 255, 255, 0.2);
                    touch-action: none;
                }
                .ge-touch-btn {
                    position: absolute;
                    pointer-events: auto;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 800;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    color: #fff;
                    cursor: pointer;
                    touch-action: none;
                    transition: transform 0.05s ease, filter 0.05s ease;
                }
                .ge-touch-btn:active, .ge-touch-btn.active {
                    transform: scale(0.92);
                    filter: brightness(1.3);
                }
                /* Fire (Z Trigger) - Primary Action */
                #ge-btn-fire {
                    bottom: 35px;
                    right: 35px;
                    width: 82px;
                    height: 82px;
                    background: rgba(220, 38, 38, 0.75);
                    font-size: 16px;
                    letter-spacing: 0.5px;
                    border-color: #f87171;
                }
                /* Open Doors / Activate (B Button) */
                #ge-btn-open {
                    bottom: 128px;
                    right: 35px;
                    width: 68px;
                    height: 68px;
                    background: rgba(37, 99, 235, 0.75);
                    font-size: 15px;
                    letter-spacing: 0.5px;
                    border-color: #60a5fa;
                }
                /* Change Gun / Weapon (A Button) */
                #ge-btn-gun {
                    bottom: 45px;
                    right: 128px;
                    width: 68px;
                    height: 68px;
                    background: rgba(217, 119, 6, 0.75);
                    font-size: 15px;
                    letter-spacing: 0.5px;
                    border-color: #fbbf24;
                }
                /* Aim (R Shoulder) */
                #ge-btn-aim {
                    bottom: 125px;
                    right: 115px;
                    width: 58px;
                    height: 58px;
                    background: rgba(147, 51, 234, 0.75);
                    font-size: 14px;
                    letter-spacing: 0.5px;
                    border-color: #c084fc;
                }
                /* Strafe Left & Right */
                #ge-btn-strafe-l {
                    bottom: 185px;
                    left: 25px;
                    width: 48px;
                    height: 48px;
                    background: rgba(55, 65, 81, 0.75);
                    font-size: 18px;
                }
                #ge-btn-strafe-r {
                    bottom: 185px;
                    left: 105px;
                    width: 48px;
                    height: 48px;
                    background: rgba(55, 65, 81, 0.75);
                    font-size: 18px;
                }
                /* Start Button */
                #ge-btn-start {
                    top: 15px;
                    right: 15px;
                    width: 70px;
                    height: 34px;
                    border-radius: 17px;
                    background: rgba(30, 41, 59, 0.85);
                    font-size: 12px;
                    letter-spacing: 0.5px;
                    border-color: #94a3b8;
                }
                /* Audio Unmute Banner */
                #ge-audio-banner {
                    position: fixed;
                    top: 15px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ff7a59;
                    color: #09090b;
                    font-weight: 800;
                    padding: 8px 18px;
                    border-radius: 20px;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
                    z-index: 99999;
                    cursor: pointer;
                    display: none;
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0% { transform: translateX(-50%) scale(1); }
                    50% { transform: translateX(-50%) scale(1.05); }
                    100% { transform: translateX(-50%) scale(1); }
                }
            </style>

            <!-- Virtual Joystick Zone (NippleJS) -->
            <div id="ge-joystick-zone" class="ge-touch-zone"></div>

            <!-- Strafe C-Buttons -->
            <div id="ge-btn-strafe-l" class="ge-touch-btn">◀</div>
            <div id="ge-btn-strafe-r" class="ge-touch-btn">▶</div>

            <!-- Right Thumb Action Cluster -->
            <div id="ge-btn-fire" class="ge-touch-btn">FIRE</div>
            <div id="ge-btn-open" class="ge-touch-btn">OPEN</div>
            <div id="ge-btn-gun" class="ge-touch-btn">GUN</div>
            <div id="ge-btn-aim" class="ge-touch-btn">AIM</div>

            <!-- Start Menu -->
            <div id="ge-btn-start" class="ge-touch-btn">START</div>

            <!-- Audio Unmute Prompt -->
            <div id="ge-audio-banner">🔊 Tap to Unmute Game Audio</div>
        `;
        const hudParent = document.getElementById('middleDiv') || document.body;
        hudParent.appendChild(hud);

        initButtons();
        initJoystick();
        initAudioBanner();
    }

    function bindTouchButton(elementId, stateKey, msVibrate) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const press = (e) => {
            e.preventDefault();
            e.stopPropagation();
            STATE[stateKey] = true;
            STATE.active = true;
            el.classList.add('active');
            vibrate(msVibrate || 15);
        };

        const release = (e) => {
            e.preventDefault();
            e.stopPropagation();
            STATE[stateKey] = false;
            el.classList.remove('active');
        };

        el.addEventListener('touchstart', press, { passive: false });
        el.addEventListener('touchend', release, { passive: false });
        el.addEventListener('touchcancel', release, { passive: false });

        // Mouse fallbacks for testing on desktop
        el.addEventListener('mousedown', press);
        el.addEventListener('mouseup', release);
        el.addEventListener('mouseleave', release);
    }

    function initButtons() {
        bindTouchButton('ge-btn-fire', 'z', 25);
        bindTouchButton('ge-btn-open', 'b', 15);  // B Button opens doors & operates switches
        bindTouchButton('ge-btn-gun', 'a', 15);   // A Button changes guns/weapons
        bindTouchButton('ge-btn-aim', 'r', 15);   // R Shoulder Button aims
        bindTouchButton('ge-btn-strafe-l', 'cLeft', 10);
        bindTouchButton('ge-btn-strafe-r', 'cRight', 10);
        bindTouchButton('ge-btn-start', 'start', 20);
    }

    function initJoystick() {
        const zone = document.getElementById('ge-joystick-zone');
        if (!zone || typeof nipplejs === 'undefined') return;

        STATE.joystickManager = nipplejs.create({
            zone: zone,
            mode: 'static',
            position: { left: '75px', top: '75px' },
            color: '#ff7a59',
            size: 100
        });

        STATE.joystickManager.on('move', (evt, data) => {
            if (data && data.vector) {
                STATE.active = true;
                // N64 analog stick values (-1.0 to 1.0)
                STATE.stickX = data.vector.x;
                STATE.stickY = -data.vector.y; // Invert Y for standard N64 stick orientation
            }
        });

        STATE.joystickManager.on('end', () => {
            STATE.stickX = 0;
            STATE.stickY = 0;
        });
    }

    function initAudioBanner() {
        const banner = document.getElementById('ge-audio-banner');
        if (!banner) return;

        function checkAudioState() {
            let blocked = false;
            // Check WebAudio
            try {
                if (window.myApp && window.myApp.audioContext && window.myApp.audioContext.state !== 'running') {
                    blocked = true;
                }
            } catch (e) {}

            // Check WebRTC video element on guest
            try {
                const vid = document.getElementById('netplay-video');
                if (vid && (vid.paused || vid.muted)) {
                    blocked = true;
                }
            } catch (e) {}

            if (blocked) {
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
        }

        banner.onclick = () => {
            unmuteAudio();
            banner.style.display = 'none';
        };

        setInterval(checkAudioState, 2000);
    }

    function unmuteAudio() {
        console.log('[GoldenEyeTouch] Unmuting audio...');
        try {
            if (window.myApp && window.myApp.audioContext) {
                window.myApp.audioContext.resume();
            }
        } catch (e) {}

        try {
            const vid = document.getElementById('netplay-video');
            if (vid) {
                vid.muted = false;
                vid.volume = 1.0;
                vid.play().catch(() => {});
            }
        } catch (e) {}
    }

    function setVisible(show) {
        STATE.enabled = show;
        const hud = document.getElementById('goldeneye-touch-hud');
        if (hud) hud.style.display = show ? 'block' : 'none';
    }

    function toggle() {
        setVisible(!STATE.enabled);
    }

    function init() {
        createHUD();
        // Auto-enable if touch device or mobile screen width
        if (isTouchDevice()) {
            setVisible(true);
        }
        // Unlock audio on first global user tap
        ['pointerdown', 'touchstart'].forEach(ev => {
            window.addEventListener(ev, () => { unmuteAudio(); }, { once: true });
        });
    }

    return {
        init: init,
        toggle: toggle,
        setVisible: setVisible,
        isVisible: () => STATE.enabled,
        getInput: () => STATE,
        unmuteAudio: unmuteAudio
    };
})();
