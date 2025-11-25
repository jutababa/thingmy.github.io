// main.js
// snappy, realistic background orbit + brightness flicker + typewave preview + results reveal

const projects = ["furnace", "structure", "observatory"]; // edit as needed
const search = document.getElementById("search");
const results = document.getElementById("results");
const preview = document.getElementById("preview");
const panel = document.getElementById("window");
const body = document.body;

// smoothing factor (lag). 0.03 is the "snappy delay" you wanted
const alpha = 0.03;

// state for smooth motion
let state = {
  tx: 0, ty: 0, // target translations
  x: 0, y: 0,   // smoothed translations
  rotT: 0,
  brightnessTarget: 1,
  brightnessCur: 1
};

// utility lerp
function lerp(a,b,t){ return a + (b-a)*t }

// small seeded pseudo-random noise generator (simple)
let noiseSeed = Math.random()*1000;
function noise() {
  noiseSeed += 0.13;
  return Math.sin(noiseSeed) * 0.5 + Math.sin(noiseSeed*1.7)*0.25;
}

// animate background & panel camera-ish motion
let t = 0;
function animate(time){
  t += 0.016; // approximate sec per frame for stable oscillation

  // target camera orbit moves in slowly-drifting random directions
  const orbitRadiusX = 32; // px
  const orbitRadiusY = 18; // px
  state.tx = Math.sin(t * 0.37 + noise()*0.4) * orbitRadiusX;
  state.ty = Math.cos(t * 0.29 + noise()*0.52) * orbitRadiusY;
  state.x = lerp(state.x, state.tx, alpha);
  state.y = lerp(state.y, state.ty, alpha);

  // apply background position drift (gives depth)
  const bgX = Math.round(state.x);
  const bgY = Math.round(state.y);
  body.style.backgroundPosition = `${bgX}px ${bgY}px`;

  // subtle panel tilt to sell the camera motion
  const tiltX = (state.y / 40) * 2; // deg
  const tiltY = (state.x / 80) * -2;
  panel.style.transform = `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateZ(0)`;

  // brightness flicker: pick a noisy target between -0.1 and +0.1
  const n = noise();
  state.brightnessTarget = 1 + (n * 0.1); // between 0.9 and 1.1
  state.brightnessCur = lerp(state.brightnessCur, state.brightnessTarget, alpha);
  body.style.filter = `brightness(${state.brightnessCur.toFixed(3)})`;

  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// ----------------- TYPE PREVIEW (animated letters) -----------------
function clearPreview(){
  preview.innerHTML = "";
}

function renderPreview(text){
  clearPreview();
  if(!text) return;
  // create spans for each char, set css variable --delay to create wave effect
  const baseDelay = 0.01; // base extra delay per letter (very snappy)
  for(let i=0;i<text.length;i++){
    const ch = text[i] === " " ? "\u00A0" : text[i];
    const span = document.createElement("span");
    span.className = "preview-letter";
    span.textContent = ch;
    // jitter the delay slightly so it feels organic
    const jitter = (Math.random()-0.5) * 0.02;
    const delay = (i * baseDelay * 0.9) + jitter;
    span.style.setProperty('--delay', `${delay}s`);
    preview.appendChild(span);
    // reveal with a tiny stagger using setTimeout — keeps it snappy
    setTimeout(()=> span.classList.add('revealed'), Math.max(0, (delay*1000) - 20));
  }
}

// keep the real input visible and caret active — preview just mirrors letters visually
search.addEventListener('input', (e)=>{
  const val = e.target.value;
  renderPreview(val);

  // results update
  results.innerHTML = "";
  if(!val.trim()){
    results.style.display = 'none';
    return;
  }
  const q = val.trim().toLowerCase();
  const matches = projects.filter(p => p.toLowerCase().includes(q));
  if(matches.length === 0){
    results.style.display = 'none';
    return;
  }
  matches.forEach((name, idx) => {
    const li = document.createElement('li');
    li.textContent = name;
    li.setAttribute('role','option');
    // stagger reveal for results
    setTimeout(()=> {
      li.classList.add('revealed');
    }, idx * 40); // fast snappy stagger (40ms)
    li.addEventListener('click', ()=> {
      window.location.href = `./${name}/index.html`;
    });
    results.appendChild(li);
  });
  results.style.display = 'block';
});

// initial preview hookup so click/typing works on mobile too
search.addEventListener('focus', ()=> preview.style.opacity = 1);
search.addEventListener('blur', ()=> {
  // keep preview visible but gently fade letters (user experience tweak)
  const letters = preview.querySelectorAll('.preview-letter');
  letters.forEach((el,i)=> {
    setTimeout(()=> el.classList.remove('revealed'), i * 10);
  });
});

// make the input's typed value invisible visually (preview handles letters) but keep caret
// to avoid confusing we do not hide value; we just keep preview on top visually.
// If you prefer to hide real text, uncomment the following line:
// search.style.color = 'transparent'

// ----------------- extra tweak: keyboard nav (nice-to-have) -----------------
let focused = -1;
search.addEventListener('keydown', (e)=>{
  const lis = Array.from(results.children);
  if(!lis.length) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); focused = (focused+1) % lis.length; lis.forEach((l,i)=> l.classList.toggle('focused', i===focused)); lis[focused].scrollIntoView({block:'nearest'}); }
  if(e.key === 'ArrowUp'){ e.preventDefault(); focused = (focused-1 + lis.length) % lis.length; lis.forEach((l,i)=> l.classList.toggle('focused', i===focused)); lis[focused].scrollIntoView({block:'nearest'}); }
  if(e.key === 'Enter' && focused >= 0){ lis[focused].click(); }
});
