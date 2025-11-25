// Resampler + Audio Physics
// Basic architecture:
// - WebAudio context + master gain
// - Load audio file into audioBuffer
// - Provide trim / root-note mapping + ADSR envelope
// - Physics canvas spawns particles; collisions trigger sample playback pitched by semitone offsets
// - Pitch mapping: n semitones => playbackRate = 2^(n/12)

// ---------- Globals ----------
let audioCtx = null;
let masterGain;
let sampleBuffer = null;
let trimmedBuffer = null;

let rootNote = 60; // MIDI
let env = { A: 0.01, D: 0.1, S: 0.8, R: 0.3 };
let decayTime = 0.5;
let grain = 1; // simple stutter count

const status = document.getElementById('status');
const fpsDisplay = document.getElementById('fps');

// ---------- UI refs ----------
const fileInput = document.getElementById('fileInput');
const waveCanvas = document.getElementById('waveCanvas');
const waveCtx = waveCanvas.getContext('2d');
const trimStartEl = document.getElementById('trimStart');
const trimEndEl = document.getElementById('trimEnd');
const applyTrimBtn = document.getElementById('applyTrim');
const startAudioBtn = document.getElementById('startAudioCtx');
const testNoteBtn = document.getElementById('testNote');
const rootNoteEl = document.getElementById('rootNote');
const envA = document.getElementById('envA');
const envD = document.getElementById('envD');
const envS = document.getElementById('envS');
const envR = document.getElementById('envR');
const decayEl = document.getElementById('decay');
const masterVol = document.getElementById('masterVol');
const grainEl = document.getElementById('grain');

// physics
const physicsCanvas = document.getElementById('physicsCanvas');
const pctx = physicsCanvas.getContext('2d');
const gravityEl = document.getElementById('gravity');
const frictionEl = document.getElementById('friction');
const sizeEl = document.getElementById('size');
const clearBtn = document.getElementById('clearParticles');
const spawnBtn = document.getElementById('spawnRandom');
const triggerModeEl = document.getElementById('triggerMode');

let particles = [];
let lastTime = performance.now();
let fpsCounter = { last: performance.now(), frames: 0 };

// ---------- Audio utils ----------
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(masterVol.value);
    masterGain.connect(audioCtx.destination);
    status.textContent = 'Audio context created — load a sample.';
  }
}

startAudioBtn.addEventListener('click', () => {
  ensureAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  status.textContent = 'Audio ready';
});

masterVol.addEventListener('input', () => {
  if (masterGain) masterGain.gain.value = parseFloat(masterVol.value);
});

// load file
fileInput.addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  ensureAudio();
  status.textContent = `Loading ${f.name}...`;
  const arr = await f.arrayBuffer();
  audioCtx.decodeAudioData(arr, buf => {
    sampleBuffer = buf;
    trimmedBuffer = sampleBuffer; // initially same
    trimStartEl.value = 0;
    trimEndEl.value = Math.max(0, sampleBuffer.duration.toFixed(2));
    drawWaveform(sampleBuffer);
    status.textContent = `Loaded: ${f.name} (${sampleBuffer.duration.toFixed(2)} s)`;
  }, err => {
    status.textContent = 'Decode error';
    console.error(err);
  });
});

// waveform drawing
function drawWaveform(buffer) {
  const canvas = waveCanvas;
  const ctx = waveCtx;
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 80 * devicePixelRatio;
  ctx.clearRect(0,0,w,h);
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,w,h);
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.strokeStyle = '#0a3b7a';
  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    const start = i * step;
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[start + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = (1 + min) * 0.5 * h;
    const y2 = (1 + max) * 0.5 * h;
    ctx.moveTo(i, y1);
    ctx.lineTo(i, y2);
  }
  ctx.stroke();
}

// trimming
applyTrimBtn.addEventListener('click', () => {
  if (!sampleBuffer) return;
  const start = Math.max(0, parseFloat(trimStartEl.value) || 0);
  const end = Math.min(sampleBuffer.duration, parseFloat(trimEndEl.value) || sampleBuffer.duration);
  const s = Math.min(start,end);
  const e = Math.max(start,end);
  const length = Math.floor((e - s) * sampleBuffer.sampleRate);
  const nb = audioCtx.createBuffer(sampleBuffer.numberOfChannels, length, sampleBuffer.sampleRate);
  for (let ch=0; ch<sampleBuffer.numberOfChannels; ch++) {
    const src = sampleBuffer.getChannelData(ch);
    const dst = nb.getChannelData(ch);
    const offset = Math.floor(s * sampleBuffer.sampleRate);
    for (let i=0;i<length;i++){
      dst[i] = src[offset + i] || 0;
    }
  }
  trimmedBuffer = nb;
  drawWaveform(trimmedBuffer);
  status.textContent = `Trim applied: ${ (e - s).toFixed(2) } s`;
});

// ---------- playback helpers ----------
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function semitoneRatio(semitones) {
  return Math.pow(2, semitones/12);
}

// Play sample pitched to targetMidi
function playSampleAtMidi(targetMidi) {
  if (!trimmedBuffer || !audioCtx) return;
  const src = audioCtx.createBufferSource();
  src.buffer = trimmedBuffer;

  // playbackRate from rootNote to targetMidi
  const semis = targetMidi - parseInt(rootNoteEl.value || rootNote);
  src.playbackRate.value = semitoneRatio(semis);

  // create envelope
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  const A = parseFloat(envA.value), D = parseFloat(envD.value), S = parseFloat(envS.value), R = parseFloat(envR.value);
  const now = audioCtx.currentTime;
  g.gain.linearRampToValueAtTime(1.0, now + A);
  g.gain.linearRampToValueAtTime(S, now + A + D);

  // optional decay tail: schedule release
  const dur = Math.max(0.05, parseFloat(decayEl.value) || decayTime);
  src.connect(g);
  g.connect(masterGain);

  // start and schedule stop
  src.start();
  // release after 'dur'
  g.gain.setTargetAtTime(0.0001, now + dur, R);
  // stop after envelope fades
  src.stop(now + dur + 1.0);
}

// quick test note: C4 (60)
testNoteBtn.addEventListener('click', () => {
  ensureAudio();
  playSampleAtMidi(60);
});

// ---------- Physics ----------
function rand(min,max){return Math.random()*(max-min)+min;}
function spawnParticle(x,y,radius){
  const p = {
    x, y,
    vx: rand(-150,150),
    vy: rand(-50, 50),
    r: radius,
    mass: radius*0.2,
    color: `hsl(${Math.random()*40 + 260} 25% ${Math.random()*20 + 40}%)`,
    id: Math.random().toString(36).slice(2)
  };
  particles.push(p);
}

physicsCanvas.addEventListener('click', (e) => {
  const rect = physicsCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (physicsCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (physicsCanvas.height / rect.height);
  spawnParticle(x, y, parseInt(sizeEl.value));
});

clearBtn.addEventListener('click', ()=> particles = []);
spawnBtn.addEventListener('click', ()=>{
  for(let i=0;i<10;i++){
    spawnParticle(rand(50, physicsCanvas.width-50), rand(20, physicsCanvas.height-20), parseInt(sizeEl.value));
  }
});

// simple physics loop
function physicsStep(dt){
  const g = parseFloat(gravityEl.value);
  const friction = parseFloat(frictionEl.value);
  // integrate
  for (let p of particles){
    p.vy += g * dt;
    p.vx *= (1 - friction);
    p.vy *= (1 - friction*0.5);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // walls
    if (p.x - p.r < 0){ p.x = p.r; p.vx *= -0.8; onTrigger('wall', p); }
    if (p.x + p.r > physicsCanvas.width){ p.x = physicsCanvas.width - p.r; p.vx *= -0.8; onTrigger('wall', p); }
    if (p.y - p.r < 0){ p.y = p.r; p.vy *= -0.8; onTrigger('wall', p); }
    if (p.y + p.r > physicsCanvas.height){ p.y = physicsCanvas.height - p.r; p.vy *= -0.8; onTrigger('wall', p); }
  }

  // collisions (pairwise)
  for (let i=0;i<particles.length;i++){
    for (let j=i+1;j<particles.length;j++){
      const a = particles[i], b = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r;
      if (dist < minDist && dist > 0){
        // simple separation
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;

        // elastic collision
        const kx = (a.vx - b.vx);
        const ky = (a.vy - b.vy);
        const p = 2 * (nx*kx + ny*ky) / (a.mass + b.mass);
        a.vx = a.vx - p * b.mass * nx;
        a.vy = a.vy - p * b.mass * ny;
        b.vx = b.vx + p * a.mass * nx;
        b.vy = b.vy + p * a.mass * ny;

        onTrigger('collide', a, b);
      }
    }
  }
}

let lastTriggerTimes = {};
function onTrigger(type, a, b){
  const mode = triggerModeEl.value;
  if (mode === 'collide' && type !== 'collide') return;
  if (mode === 'wall' && type !== 'wall') return;
  // 'bounce' triggers both

  // throttle per particle pair
  const key = (a?.id || '') + (b?.id || '');
  const now = performance.now();
  if (lastTriggerTimes[key] && now - lastTriggerTimes[key] < 50) return;
  lastTriggerTimes[key] = now;

  // choose trigger position to map to pitch (use y coordinate)
  const y = (b ? (a.y + b.y)/2 : a.y);
  // map y (0..height) to midi range e.g., 84 (C6) down to 36 (C2)
  const topMidi = 84, bottomMidi = 36;
  const norm = 1 - Math.max(0, Math.min(1, y / physicsCanvas.height));
  const midi = Math.round(bottomMidi + norm * (topMidi - bottomMidi));

  // play grain times (simple stutter variation)
  const gcount = parseInt(grainEl.value) || 1;
  for (let i=0;i<gcount;i++){
    setTimeout(()=> {
      ensureAudio();
      playSampleAtMidi(midi);
    }, i * (30)); // tiny stagger
  }
}

// ---------- render ----------
function renderLoop(now){
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // FPS
  fpsCounter.frames++;
  if (now - fpsCounter.last > 500) {
    fpsDisplay.textContent = 'FPS: ' + Math.round((fpsCounter.frames * 1000) / (now - fpsCounter.last));
    fpsCounter.last = now;
    fpsCounter.frames = 0;
  }

  physicsStep(dt);
  drawPhysics();
  requestAnimationFrame(renderLoop);
}

function drawPhysics(){
  // clear
  pctx.clearRect(0,0,physicsCanvas.width, physicsCanvas.height);
  // background mesh
  pctx.save();
  pctx.globalAlpha = 0.12;
  for (let i=0;i<physicsCanvas.width;i+=30){
    pctx.beginPath();
    pctx.moveTo(i,0);
    pctx.lineTo(i,physicsCanvas.height);
    pctx.strokeStyle = 'rgba(0,0,0,0.02)';
    pctx.stroke();
  }
  pctx.restore();

  // particles
  for (let p of particles){
    pctx.beginPath();
    pctx.fillStyle = p.color;
    pctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    pctx.fill();
    pctx.lineWidth = 1;
    pctx.strokeStyle = 'rgba(0,0,0,0.15)';
    pctx.stroke();
  }
}

// resize canvas to CSS pixels * devicePixelRatio
function resizeCanvases() {
  // physics canvas
  const cs = physicsCanvas.getBoundingClientRect();
  physicsCanvas.width = Math.floor(cs.width * devicePixelRatio);
  physicsCanvas.height = Math.floor(cs.height * devicePixelRatio);
  // wave canvas already redraws on load
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();
requestAnimationFrame(renderLoop);

// ---------- helpers: MIDI keyboard (QWERTY) ----------
const keyMap = {
  'a': 60, 'w':61, 's':62, 'e':63, 'd':64, 'f':65, 't':66, 'g':67, 'y':68, 'h':69, 'u':70, 'j':71, 'k':72
};
window.addEventListener('keydown', (ev)=>{
  if (!audioCtx) return;
  const k = ev.key.toLowerCase();
  if (keyMap[k]) {
    playSampleAtMidi(keyMap[k]);
  }
});

// initial status
status.textContent = 'Idle — start audio and load a sample.';
