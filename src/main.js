import './styles.css';

// DOM Elements
const canvas = document.getElementById('particles');
const ctx = canvas.getContext('2d');
const eyeBtn = document.getElementById('eye-btn');
const calibrationOverlay = document.getElementById('calibration-overlay');
const calibrationDot = document.getElementById('calibration-dot');
const calibrationProgress = document.getElementById('calibration-progress');
const gazeDot = document.getElementById('gaze-dot');

// State
let isCalibrating = false;
let calibrationPoints = [];
let currentCalibrationIndex = 0;
const CALIBRATION_POSITIONS = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 },
  { x: 0.5, y: 0.9 },
  { x: 0.9, y: 0.9 },
];

// Particle System
const particles = [];
const PARTICLE_COUNT = 150;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let gazeX = window.innerWidth / 2;
let gazeY = window.innerHeight / 2;
let useGaze = false;

class Particle {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 2 + 1;
    this.speedX = (Math.random() - 0.5) * 0.5;
    this.speedY = (Math.random() - 0.5) * 0.5;
    this.opacity = Math.random() * 0.5 + 0.2;
  }

  update() {
    const targetX = useGaze ? gazeX : mouseX;
    const targetY = useGaze ? gazeY : mouseY;
    
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 200) {
      const force = (200 - dist) / 200;
      this.speedX += (dx / dist) * force * 0.02;
      this.speedY += (dy / dist) * force * 0.02;
    }

    this.speedX *= 0.98;
    this.speedY *= 0.98;
    
    this.x += this.speedX;
    this.y += this.speedY;

    if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
      this.reset();
    }
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(59, 130, 246, ${this.opacity})`;
    ctx.fill();
  }
}

function initParticles() {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  particles.forEach(particle => {
    particle.update();
    particle.draw();
  });

  // Draw connections
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.1)';
  ctx.lineWidth = 0.5;
  
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 100) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }

  requestAnimationFrame(animate);
}

// Mouse tracking
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

// Eye tracking setup
async function initEyeTracking() {
  eyeBtn.disabled = true;
  eyeBtn.textContent = 'Initializing...';

  try {
    await webgazer
      .setGazeListener((data) => {
        if (data && !isCalibrating) {
          gazeX = data.x;
          gazeY = data.y;
          gazeDot.style.left = `${data.x}px`;
          gazeDot.style.top = `${data.y}px`;
        }
      })
      .saveDataAcrossSessions(true)
      .begin();

    webgazer.showVideoPreview(false);
    webgazer.showPredictionPoints(false);
    
    startCalibration();
  } catch (err) {
    console.error('Eye tracking error:', err);
    eyeBtn.disabled = false;
    eyeBtn.textContent = 'Failed - Try again';
  }
}

function startCalibration() {
  isCalibrating = true;
  currentCalibrationIndex = 0;
  calibrationOverlay.hidden = false;
  eyeBtn.style.display = 'none';
  
  showNextCalibrationPoint();
}

function showNextCalibrationPoint() {
  if (currentCalibrationIndex >= CALIBRATION_POSITIONS.length) {
    finishCalibration();
    return;
  }

  const pos = CALIBRATION_POSITIONS[currentCalibrationIndex];
  calibrationDot.hidden = false;
  calibrationDot.style.left = `${pos.x * window.innerWidth}px`;
  calibrationDot.style.top = `${pos.y * window.innerHeight}px`;
  calibrationProgress.textContent = `Point ${currentCalibrationIndex + 1} of ${CALIBRATION_POSITIONS.length}`;
}

function handleCalibrationClick() {
  if (!isCalibrating) return;
  
  const pos = CALIBRATION_POSITIONS[currentCalibrationIndex];
  const x = pos.x * window.innerWidth;
  const y = pos.y * window.innerHeight;
  
  // Record calibration point
  webgazer.recordScreenPosition(x, y, 'click');
  
  currentCalibrationIndex++;
  showNextCalibrationPoint();
}

function finishCalibration() {
  isCalibrating = false;
  calibrationOverlay.hidden = true;
  calibrationDot.hidden = true;
  gazeDot.classList.add('visible');
  useGaze = true;
  
  document.removeEventListener('click', handleCalibrationClick);
}

// Event listeners
eyeBtn.addEventListener('click', initEyeTracking);

document.addEventListener('click', (e) => {
  if (isCalibrating && e.target !== eyeBtn) {
    handleCalibrationClick();
  }
});

window.addEventListener('resize', resizeCanvas);

// Initialize
resizeCanvas();
initParticles();
animate();
