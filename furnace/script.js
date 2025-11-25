/* Furnace demo
   - Particles are circles with temperature.
   - Neighboring particles exchange heat by conduction.
   - Heater adds energy to particles in heater zone.
   - Ambient and insulation control heat loss.
   - Convection approximated by adding random drift when on.
*/

// ======= helpers =======
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;

// ======= UI elements =======
const canvas = $('simCanvas');
const ctx = canvas.getContext('2d');

const heaterPowerInput = $('heaterPower');
const ambientInput = $('ambientTemp');
const conductivityInput = $('conductivity');
const insulationInput = $('insulation');
const convectionSelect = $('convectionMode');
const toggleHeaterBtn = $('toggleHeater');
const resetBtn = $('resetBtn');

const heaterPowerLabel = $('heaterPowerLabel');
const ambientLabel = $('ambientLabel');
const conductivityLabel = $('conductivityLabel');
const insulationLabelEl = $('insulationLabel');

const avgTempEl = $('avgTemp');
const energyKJEl = $('energyKJ');
const phaseEl = $('phase');
const heaterStatusEl = $('heaterStatus');

const explanationsEl = $('explanations');

// ======= simulation constants =======
let WIDTH = canvas.width;
let HEIGHT = canvas.height;

const NUM_PARTICLES = 180; // grade 7 friendly count
const PARTICLE_RADIUS = 4; // px
const PARTICLE_MASS = 1; // arbitrary unit
const SPECIFIC_HEAT = 0.9; // J/(g·°C) scaled — not real units but intuitive

// Phase thresholds based on average temp (approx)
const MELT_TEMP = 0;   // 0°C = melting for water
const BOIL_TEMP = 100; // 100°C = boiling for water

// Heater rectangle (screen coords)
const heaterZone = {
  x: WIDTH - 170,
  y: HEIGHT - 90,
  w: 130,
  h: 70
};

let isHeaterOn = true;

// ======= particles =======
class Particle {
  constructor(x,y) {
    this.x = x; this.y = y;
    this.vx = (Math.random()-0.5)*0.4;
    this.vy = (Math.random()-0.5)*0.4;
    this.temp = 20 + (Math.random()-0.5)*6; // start around ambient
    this.radius = PARTICLE_RADIUS;
    this.mass = PARTICLE_MASS;
  }

  kineticStep(dt) {
    // small Brownian motion-ish movement influenced by temperature
    const speedFactor = 0.02 * Math.max(0, (this.temp - 10)); // hotter -> more jitter
    this.vx += (Math.random()-0.5)*speedFactor;
    this.vy += (Math.random()-0.5)*speedFactor;

    // integrate
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // walls: bounce softly
    if (this.x < this.radius) { this.x = this.radius; this.vx *= -0.6; }
    if (this.x > WIDTH - this.radius) { this.x = WIDTH - this.radius; this.vx *= -0.6; }
    if (this.y < this.radius) { this.y = this.radius; this.vy *= -0.6; }
    if (this.y > HEIGHT - this.radius) { this.y = HEIGHT - this.radius; this.vy *= -0.6; }
  }
}

let particles = [];

// ======= simulation state =======
function initParticles() {
  particles = [];
  const cols = Math.ceil(Math.sqrt(NUM_PARTICLES));
  const spacingX = (WIDTH-220) / cols;
  const spacingY = HEIGHT / cols;
  let i = 0;
  for (let r=0; r<cols; r++){
    for (let c=0; c<cols; c++){
      if (i++ >= NUM_PARTICLES) break;
      const x = 20 + c * spacingX + (Math.random()-0.5)*6;
      const y = 20 + r * spacingY + (Math.random()-0.5)*6;
      particles.push(new Particle(x,y));
    }
  }
}

// ======= draw helpers =======
function tempToColor(temp){
  // map temperature to a smooth color from blue (cold) to yellow/red (hot)
  // clamp between -20 and 200
  const t = clamp((temp + 20) / 220, 0, 1);
  // simple gradient: blue -> cyan -> yellow -> red
  if (t < 0.33) {
    const s = t / 0.33;
    // blue(60,120,220) -> cyan(80,200,200)
    const r = Math.round(60 + (80-60)*s);
    const g = Math.round(120 + (200-120)*s);
    const b = Math.round(220 + (200-220)*s);
    return `rgb(${r},${g},${b})`;
  } else if (t < 0.66) {
    const s = (t-0.33)/0.33;
    // cyan -> yellow
    const r = Math.round(80 + (230-80)*s);
    const g = Math.round(200 + (230-200)*s);
    const b = Math.round(200 - (200-80)*s);
    return `rgb(${r},${g},${b})`;
  } else {
    const s = (t-0.66)/0.34;
    // yellow -> red
    const r = Math.round(230 + (255-230)*s);
    const g = Math.round(230 - (230-40)*s);
    const b = Math.round(80 - (80-30)*s);
    return `rgb(${r},${g},${b})`;
  }
}

function draw() {
  ctx.clearRect(0,0,WIDTH,HEIGHT);

  // background subtle grid
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.restore();

  // particles
  for (const p of particles){
    ctx.beginPath();
    ctx.fillStyle = tempToColor(p.temp);
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
    ctx.fill();

    // slight halo for hotter particles
    if (p.temp > 60) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = tempToColor(p.temp);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius*3, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  // draw heater rectangle
  ctx.save();
  ctx.fillStyle = isHeaterOn ? 'rgba(230,90,40,0.9)' : 'rgba(150,150,150,0.5)';
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  roundRect(ctx, heaterZone.x, heaterZone.y, heaterZone.w, heaterZone.h, 8, true, false);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '12px sans-serif';
  ctx.fillText(isHeaterOn ? 'heater (on)' : 'heater (off)', heaterZone.x + 8, heaterZone.y + 18);
  ctx.fillText('click to toggle', heaterZone.x + 8, heaterZone.y + 36);
  ctx.restore();
}

function roundRect(ctx,x,y,w,h,r,fill,stroke){
  if (typeof r === 'undefined') r=5;
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// ======= physics: heat transfer =======
function simulationStep(dt) {
  // dt in ms scaled
  const dtSec = dt / 16.6667; // normalize to ~60fps steps

  const ambient = parseFloat(ambientInput.value);
  const heaterPower = isHeaterOn ? parseFloat(heaterPowerInput.value) : 0;
  const conductivity = parseFloat(conductivityInput.value); // higher -> faster conduction
  const insulation = parseFloat(insulationInput.value); // higher -> reduces heat loss to ambient (0..1)
  const convectionMode = convectionSelect.value;

  // 1) motions
  for (const p of particles) {
    // convection: add small drift based on mode
    if (convectionMode === 'gentle') {
      p.vy -= 0.0008 * (p.temp - ambient); // hot rises slowly
    } else if (convectionMode === 'strong') {
      p.vy -= 0.002 * (p.temp - ambient);
    }
    p.kineticStep(dtSec);
  }

  // 2) conduction: neighbor exchange (approx by spatial hashing)
  // We'll do a simple N^2-ish but limited by distance
  const maxDist = 18;
  for (let i=0;i<particles.length;i++){
    const a = particles[i];
    for (let j=i+1;j<particles.length;j++){
      const b = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx*dx + dy*dy;
      if (d2 > maxDist*maxDist) continue;
      const d = Math.sqrt(d2) || 0.0001;
      // conduction flux proportional to difference and conductivity, scaled by distance
      const dT = b.temp - a.temp;
      const contact = clamp(1 - d / maxDist, 0, 1);
      const flux = 0.01 * conductivity * contact * dT; // small step
      // update temps (conserve)
      a.temp += flux;
      b.temp -= flux;
    }
  }

  // 3) heater: add energy to particles inside heater zone
  // distribute heaterPower (watts) across particles inside, scaled by dt
  if (heaterPower > 0) {
    const inside = particles.filter(p => p.x >= heaterZone.x && p.x <= heaterZone.x+heaterZone.w && p.y >= heaterZone.y && p.y <= heaterZone.y+heaterZone.h);
    if (inside.length > 0) {
      // simple: each particle gets a portion of energy
      const energyPerParticle = (heaterPower / inside.length) * dt / 1000; // scaled
      for (const p of inside) {
        // increase temperature by delta = energy / (mass * cp)
        p.temp += energyPerParticle / (p.mass * SPECIFIC_HEAT);
      }
    }
  }

  // 4) heat loss to ambient (radiative/conductive to surroundings)
  // particles lose heat toward ambient based on insulation
  const lossFactor = 0.002 * (1 - insulation); // more insulation -> smaller loss
  for (const p of particles){
    // Newton's law of cooling simple form
    p.temp += (ambient - p.temp) * lossFactor * dtSec;
  }

  // 5) minimal diffusion to avoid clumping of temps — keep system smooth
  // small global smoothing pass
  const temps = particles.map(p => p.temp);
  for (let i=0;i<particles.length;i++){
    particles[i].temp = lerp(particles[i].temp, temps[Math.max(0,i-1)] || particles[i].temp, 0.02);
  }
}

// ======= UI / binding =======
function updateLabels(){
  heaterPowerLabel.textContent = heaterPowerInput.value;
  ambientLabel.textContent = ambientInput.value;
  conductivityLabel.textContent = conductivityInput.value;
  insulationLabelEl.textContent = insulationInput.value;
  heaterStatusEl.textContent = isHeaterOn ? 'on' : 'off';
}

heaterPowerInput.addEventListener('input', updateLabels);
ambientInput.addEventListener('input', updateLabels);
conductivityInput.addEventListener('input', updateLabels);
insulationInput.addEventListener('input', updateLabels);

toggleHeaterBtn.addEventListener('click', () => {
  isHeaterOn = !isHeaterOn;
  updateLabels();
});

resetBtn.addEventListener('click', () => {
  initParticles();
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  // toggle heater if clicked inside its rectangle
  if (x >= heaterZone.x && x <= heaterZone.x+heaterZone.w && y >= heaterZone.y && y <= heaterZone.y+heaterZone.h) {
    isHeaterOn = !isHeaterOn;
    updateLabels();
  } else {
    // otherwise add a little local heat pulse (teach: like lighting a match)
    for (const p of particles) {
      const d2 = (p.x - x)*(p.x - x) + (p.y - y)*(p.y - y);
      if (d2 < 40*40) p.temp += 6 * (1 - Math.sqrt(d2)/40);
    }
  }
});

// ======= readouts and explanation text =======
function updateReadouts(){
  const avgTemp = particles.reduce((s,p)=>s+p.temp,0) / particles.length;
  const totalEnergy = particles.reduce((s,p)=>s + (p.temp * p.mass * SPECIFIC_HEAT), 0);
  avgTempEl.textContent = avgTemp.toFixed(1);
  energyKJEl.textContent = (totalEnergy/1000).toFixed(3);

  // phase (approx) based on average temp
  if (avgTemp < MELT_TEMP - 5) {
    phaseEl.textContent = 'solid (approx)';
  } else if (avgTemp < BOIL_TEMP - 5) {
    phaseEl.textContent = 'liquid (approx)';
  } else {
    phaseEl.textContent = 'gas (approx)';
  }
}

function fillExplanations(){
  explanationsEl.innerHTML = `
    <p>ok</p>
    <ul>
      <li><strong>particles:</strong> matter is made of tiny moving particles. their speed = temperature.</li>
      <li><strong>temperature vs thermal energy:</strong> temperature is how fast particles move, thermal energy is how much total heat is stored (depends on how many particles and their temp, say average amount of all of the particles kinda like that).</li>
      <li><strong>conduction:</strong> particles exchange heat when they bump into each other. higher conductivity makes heat move faster between particles.</li>
      <li><strong>insulation:</strong> slows energy leaving to the outside, the slider reduces how quickly particles cool to ambient.</li>
      <li><strong>heater:</strong> adds energy (watts) to particles in the heater zone, that's how we warm things in real life.</li>
      <li><strong>convection:</strong> warm particles rise a bit, turning this on shows how air movement helps move heat.</li>
      <li><strong>phase change:</strong> if average temp passes melting/boiling points, you'll see the "phase" label change, good for discussing energy needed to change state.</li>
      <li><strong>energy conservation:</strong> energy added by the heater increases particle energy: insulation and ambient settings show how energy is lost or kept.</li>
    </ul>
    <p>try these demo activities: raise heater power, lower insulation, switch on strong convection, or click the heater to toggle. notice avg temp and energy changes. i think it's okay</p>
  `;
}

// ======= main loop =======
let last = performance.now();
function loop(now) {
  const dt = now - last;
  last = now;
  simulationStep(dt);
  draw();
  updateReadouts();
  requestAnimationFrame(loop);
}

// ======= resize handling for crisp canvas and layout =======
function resize() {
  // maintain canvas internal resolution for crispness
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  // update constants
  WIDTH = canvas.width;
  HEIGHT = canvas.height;
  // recalc heater zone relative to size
  heaterZone.x = WIDTH - Math.min(220, Math.round(WIDTH*0.22));
  heaterZone.y = HEIGHT - Math.min(120, Math.round(HEIGHT*0.18));
  heaterZone.w = Math.min(200, Math.round(WIDTH*0.16));
  heaterZone.h = Math.min(100, Math.round(HEIGHT*0.14));
}

// initial boot
function boot() {
  // small layout fix: ensure canvas displays at intended pixel size
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  resize();
  initParticles();
  updateLabels();
  fillExplanations();
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => {
  // debounce-ish
  setTimeout(()=>{ resize(); }, 50);
});

boot();
