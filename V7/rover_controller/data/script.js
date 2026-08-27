let ws;
let ledOn = false;

function connect(){
  ws = new WebSocket(`ws://${location.hostname}/ws`);
  ws.onopen = () => setStatus(true);
  ws.onclose = () => { setStatus(false); setTimeout(connect, 1500); };
  ws.onerror = () => ws.close();
}
function setStatus(on){
  document.getElementById('statusDot').classList.toggle('on', on);
  document.getElementById('statusText').textContent = on ? 'CONNECTED' : 'DISCONNECTED';
}
function send(obj){
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
connect();

// ---------- Axis-locked joystick ----------
// axis: 'y' -> only vertical movement (throttle), 'x' -> only horizontal movement (steering)
function setupJoystick(baseId, knobId, axis, onMove, onRelease){
  const base = document.getElementById(baseId);
  const knob = document.getElementById(knobId);
  const radius = base.offsetWidth / 2;
  const travel = radius - 20;
  let dragging = false;

  function setKnob(x, y){
    knob.style.left = (radius + x) + 'px';
    knob.style.top  = (radius + y) + 'px';
  }

  function handle(clientX, clientY){
    const rect = base.getBoundingClientRect();
    let dx = clientX - (rect.left + radius);
    let dy = clientY - (rect.top + radius);

    if (axis === 'y') {
      dx = 0;
      dy = Math.max(-travel, Math.min(travel, dy));
    } else {
      dy = 0;
      dx = Math.max(-travel, Math.min(travel, dx));
    }
    setKnob(dx, dy);

    if (axis === 'y') {
      onMove(-(dy / travel)); // up = positive
    } else {
      onMove(dx / travel);    // right = positive
    }
  }

  function reset(){
    setKnob(0, 0);
    dragging = false;
    if (onRelease) onRelease();
  }

  base.addEventListener('pointerdown', e => {
    dragging = true;
    base.setPointerCapture(e.pointerId);
    handle(e.clientX, e.clientY);
  });
  base.addEventListener('pointermove', e => { if (dragging) handle(e.clientX, e.clientY); });
  base.addEventListener('pointerup', reset);
  base.addEventListener('pointercancel', reset);
}

// Left joystick -> throttle only (forward/backward)
setupJoystick('joyDrive', 'knobDrive', 'y',
  (val) => send({type:'throttle', value: val}),
  () => send({type:'throttle', value: 0})
);

// Right joystick -> steering only (left/right)
setupJoystick('joySteer', 'knobSteer', 'x',
  (val) => send({type:'steer', value: val}),
  () => send({type:'steer', value: 0})
);

// ---------- Generic vertical drag control (knob + track + fill) ----------
// Calls back with (yPos, travelDistance, setPos) on every drag move.
// setPos(y) lets the callback snap the knob to an exact position (e.g. for gear detents).
function setupVerticalDrag(trackEl, knobEl, fillEl, onDrag){
  const trackHeight = trackEl.clientHeight;
  const knobSize = knobEl.offsetHeight;
  const travel = trackHeight - knobSize;
  let dragging = false;

  function setPos(y){
    y = Math.max(0, Math.min(travel, y));
    knobEl.style.top = y + 'px';
    if (fillEl) fillEl.style.height = (trackHeight - y) + 'px';
  }

  function handle(clientY){
    const rect = trackEl.getBoundingClientRect();
    let y = clientY - rect.top - knobSize / 2;
    y = Math.max(0, Math.min(travel, y));
    onDrag(y, travel, setPos);
  }

  trackEl.addEventListener('pointerdown', e => {
    dragging = true;
    trackEl.setPointerCapture(e.pointerId);
    handle(e.clientY);
  });
  trackEl.addEventListener('pointermove', e => { if (dragging) handle(e.clientY); });
  trackEl.addEventListener('pointerup', () => dragging = false);
  trackEl.addEventListener('pointercancel', () => dragging = false);

  return { setPos, travel, trackHeight };
}

// ---------- Gear slider: drags freely but snaps to 5 detents (1-5 -> 20-100%) ----------
const gearTrack = document.getElementById('gearTrack');
const gearKnob = document.getElementById('gearKnob');
const gearFill = document.getElementById('gearFill');
const gearTickLabels = document.querySelectorAll('#gearTicks span');
const speedValue = document.getElementById('speedValue');
let currentGear = 1;

function updateGearUI(gear){
  currentGear = gear;
  speedValue.textContent = (gear * 20) + '%';
  gearTickLabels.forEach(s => s.classList.toggle('active', parseInt(s.dataset.gear) === gear));
}

const gearCtl = setupVerticalDrag(gearTrack, gearKnob, gearFill, (y, travel, setPos) => {
  const fraction = y / travel;                       // 0 = top (gear 5), 1 = bottom (gear 1)
  const gear = Math.max(1, Math.min(5, Math.round(5 - fraction * 4)));
  const snappedFraction = (5 - gear) / 4;
  setPos(snappedFraction * travel);                   // snap knob into the detent
  if (gear !== currentGear) {
    updateGearUI(gear);
    send({type:'speed', value: gear * 20});
  }
});
gearCtl.setPos(((5 - currentGear) / 4) * gearCtl.travel); // start at gear 1 (bottom)

// ---------- Servo slider: continuous drag, 0-180 degrees ----------
const servoTrack = document.getElementById('servoTrack');
const servoKnob = document.getElementById('servoKnob');
const servoFill = document.getElementById('servoFill');
const servoVal = document.getElementById('servoVal');
let currentAngle = 90;

const servoCtl = setupVerticalDrag(servoTrack, servoKnob, servoFill, (y, travel, setPos) => {
  const fraction = y / travel;                        // 0 = top (180deg), 1 = bottom (0deg)
  const angle = Math.max(0, Math.min(180, Math.round(180 * (1 - fraction))));
  setPos(y);
  if (angle !== currentAngle) {
    currentAngle = angle;
    servoVal.textContent = angle + '°';
    send({type:'servo', value: angle});
  }
});
servoCtl.setPos(((180 - currentAngle) / 180) * servoCtl.travel); // start centered at 90deg

// ---------- LED toggle ----------
document.getElementById('ledBtn').addEventListener('click', () => {
  ledOn = !ledOn;
  document.getElementById('ledBtn').classList.toggle('active', ledOn);
  send({type:'led', state: ledOn});
});

// ---------- Stop button ----------
document.getElementById('stopBtn').addEventListener('click', () => send({type:'stop'}));

// Safety: stop motors if the tab loses focus/visibility
document.addEventListener('visibilitychange', () => { if (document.hidden) send({type:'stop'}); });
