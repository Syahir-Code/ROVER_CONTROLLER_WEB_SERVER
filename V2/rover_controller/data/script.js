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
  document.getElementById('statusText').textContent = on ? 'LINKED' : 'LINK DOWN';
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

// ---------- Gear shifter (5 fixed speed steps: 20/40/60/80/100%) ----------
const gearNotches = document.querySelectorAll('.gear-notch');
const speedValue = document.getElementById('speedValue');

gearNotches.forEach(notch => {
  notch.addEventListener('click', () => {
    gearNotches.forEach(n => n.classList.remove('active'));
    notch.classList.add('active');
    const gear = parseInt(notch.dataset.gear);
    const percent = gear * 20;
    speedValue.textContent = percent + '%';
    send({type:'speed', value: percent});
  });
});

// ---------- Servo vertical slider ----------
const servoSlider = document.getElementById('servoSlider');
const servoVal = document.getElementById('servoVal');
servoSlider.addEventListener('input', () => {
  servoVal.textContent = servoSlider.value + '°';
  send({type:'servo', value: parseInt(servoSlider.value)});
});

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
