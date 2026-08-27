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

// ---------- Generic draggable joystick ----------
function setupJoystick(baseId, knobId, onMove, onRelease){
  const base = document.getElementById(baseId);
  const knob = document.getElementById(knobId);
  const radius = base.offsetWidth / 2;
  let dragging = false;

  function setKnob(x, y){
    knob.style.left = (radius + x) + 'px';
    knob.style.top  = (radius + y) + 'px';
  }

  function handle(clientX, clientY){
    const rect = base.getBoundingClientRect();
    let dx = clientX - (rect.left + radius);
    let dy = clientY - (rect.top + radius);
    const dist = Math.min(Math.hypot(dx, dy), radius - 20);
    const angle = Math.atan2(dy, dx);
    dx = Math.cos(angle) * dist;
    dy = Math.sin(angle) * dist;
    setKnob(dx, dy);
    const nx = dx / (radius - 20);
    const ny = -(dy / (radius - 20)); // invert Y: up = positive
    onMove(nx, ny);
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

// Drive joystick -> motors
setupJoystick('joyDrive', 'knobDrive',
  (x, y) => send({type:'joystick', x, y}),
  () => send({type:'joystick', x:0, y:0})
);

// Cam joystick -> two servos (x = servo1 pan, y = servo2 tilt)
setupJoystick('joyCam', 'knobCam',
  (x, y) => {
    const s1 = Math.round(90 + x * 90);
    const s2 = Math.round(90 + y * 90);
    document.getElementById('servo1Slider').value = s1;
    document.getElementById('servo2Slider').value = s2;
    document.getElementById('servo1Val').textContent = s1 + '°';
    document.getElementById('servo2Val').textContent = s2 + '°';
    send({type:'servo1', value:s1});
    send({type:'servo2', value:s2});
  }
);

// Speed slider
const speedSlider = document.getElementById('speedSlider');
speedSlider.addEventListener('input', () => {
  document.getElementById('speedVal').textContent = speedSlider.value + '%';
  send({type:'speed', value: parseInt(speedSlider.value)});
});

// Manual servo sliders (still usable independently of the cam joystick)
['servo1','servo2'].forEach(id => {
  const s = document.getElementById(id + 'Slider');
  s.addEventListener('input', () => {
    document.getElementById(id + 'Val').textContent = s.value + '°';
    send({type:id, value: parseInt(s.value)});
  });
});

// LED toggle
document.getElementById('ledBtn').addEventListener('click', () => {
  ledOn = !ledOn;
  document.getElementById('ledBtn').classList.toggle('active', ledOn);
  send({type:'led', state: ledOn});
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', () => send({type:'stop'}));

// Safety: stop motors if the tab loses focus/visibility
document.addEventListener('visibilitychange', () => { if (document.hidden) send({type:'stop'}); });
