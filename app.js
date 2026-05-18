const pages = [
  { id: 'home',      label: 'Home' },
  { id: 'rules',     label: 'Rules' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'scoring',   label: 'Scoring' },
  { id: 'shots',     label: 'Shots' },
  { id: 'strategy',  label: 'Strategy' },
  { id: 'glossary',  label: 'Glossary' },
];

const navList   = document.getElementById('nav-list');
const content   = document.getElementById('content');
let currentPage = null;

// Build sidebar
pages.forEach(({ id, label }) => {
  const li = document.createElement('li');
  const a  = document.createElement('a');
  a.href        = `#${id}`;
  a.textContent = label;
  a.dataset.page = id;
  a.addEventListener('click', e => { e.preventDefault(); navigate(id); });
  li.appendChild(a);
  navList.appendChild(li);
});

// Render markdown page
async function navigate(id) {
  if (id === currentPage) return;
  currentPage = id;

  // Update active link
  document.querySelectorAll('#nav-list a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === id);
  });

  // Update URL hash without scroll jump
  history.replaceState(null, '', `#${id}`);
  document.title = `${pages.find(p => p.id === id)?.label ?? id} — Pickleball Wiki`;

  content.innerHTML = '<p class="loading">Loading…</p>';
  content.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch(`pages/${id}.md`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();

    // Rewrite [text](page) links to hash links
    const linked = md.replace(/\[([^\]]+)\]\(([a-z_-]+)\)/g, (_, text, href) => {
      const isKnown = pages.some(p => p.id === href);
      return isKnown ? `[${text}](#${href})` : `[${text}](${href})`;
    });

    content.innerHTML = marked.parse(linked);

    // Make in-wiki links navigate without page reload
    content.querySelectorAll('a[href^="#"]').forEach(a => {
      const target = a.getAttribute('href').slice(1);
      if (pages.some(p => p.id === target)) {
        a.addEventListener('click', e => { e.preventDefault(); navigate(target); });
      }
    });
  } catch (err) {
    content.innerHTML = `<p class="error-msg">Could not load page "<strong>${id}</strong>". ${err.message}</p>`;
  }
}

// Initial load from hash or default to home
const initial = location.hash.slice(1);
navigate(pages.some(p => p.id === initial) ? initial : 'home');
