// Smooth fade-in on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.section, .stat, .phase, .mech, .layer, .founder-card').forEach((el) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  observer.observe(el);
});

// Parallax glow follow
let ticking = false;
document.addEventListener('mousemove', (e) => {
  if (!ticking) {
    requestAnimationFrame(() => {
      const glow = document.querySelector('.bg-glow');
      if (glow) {
        const x = (e.clientX / window.innerWidth - 0.5) * 40;
        const y = (e.clientY / window.innerHeight - 0.5) * 40;
        glow.style.transform = `translate(calc(-50% + ${x}px), ${y}px)`;
      }
      ticking = false;
    });
    ticking = true;
  }
});
