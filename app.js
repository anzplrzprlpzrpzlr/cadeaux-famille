import { createStore } from './store.js?v=5';

const CATS = {
  petit: 'Petit plaisir',
  abordable: 'Abordable',
  gros: 'Gros cadeau',
};
const OCCASIONS = {
  noel: '🎄 Noël',
  anniversaire: '🎂 Anniversaire',
  autre: '✨ Autre occasion',
};
const PALETTE =['#e8590c', '#c2255c', '#7048e8', '#1971c2', '#0c8599', '#2b8a3e', '#e67700', '#862e9c', '#d6336c', '#5c940d'];
const ME_KEY = 'cadeaux.me';

const app = document.getElementById('app');
const state = { store: null, people: [], me: null, gifts: [], feed: [], mine: [], editingId: null, loading: true, flash: null };

// ---------- utilitaires ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const person = (id) => state.people.find((p) => p.id === id);

function colorOf(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Photo de profil si la personne en a mis une, sinon son initiale sur fond de couleur.
function avatar(id, big = false) {
  const p = person(id);
  const cls = big ? 'dot big' : 'dot';
  const url = p?.avatar_url;
  if (url && (/^https:\/\//.test(url) || /^data:image\//.test(url))) return `<img class="${cls}" src="${esc(url)}" alt="">`;
  return `<span class="${cls}">${esc(p?.name.trim()[0]?.toUpperCase() ?? '?')}</span>`;
}

function bubble(id, extra = '') {
  const name = person(id)?.name ?? '?';
  return `<span class="bubble" style="--c:${colorOf(id)}">${avatar(id)}${esc(name)}${extra ? ` <b>${esc(extra)}</b>` : ''}</span>`;
}

function photoPicker() {
  return `
    <label class="photo-pick">
      ${avatar(state.me, true)}
      <span>📷 ${person(state.me)?.avatar_url ? 'Changer ma photo' : 'Ajouter ma photo'}</span>
      <input type="file" accept="image/*" data-change="avatar" hidden>
    </label>`;
}

// Recadre la photo en carré et la réduit, pour qu'elle reste légère à charger.
async function squareJpeg(file, size = 320) {
  let img;
  try {
    img = await createImageBitmap(file);
  } catch {
    throw new Error('Ce format de photo n’est pas pris en charge, essaie avec un JPEG ou un PNG');
  }
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Impossible de préparer la photo'))), 'image/jpeg', 0.85));
}

const shortDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const hasPrice = (g) => g.price !== null && g.price !== undefined && g.price !== '';
// Montant indicatif correspondant à un pourcentage d'un gros cadeau, ex. « ≈ 150 € ».
const shareOf = (g, percent) => (hasPrice(g) ? ` ≈ ${EUROS.format(Math.round((Number(g.price) * percent) / 100))}` : '');

function occasionSelect(selected = 'noel') {
  const options = Object.entries(OCCASIONS)
    .map(([k, label]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${label}</option>`).join('');
  return `<select name="occasion" aria-label="Occasion">${options}</select>`;
}

function safeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function route() {
  const m = location.hash.match(/^#\/liste\/([\w-]+)/);
  return m ? { view: 'list', id: m[1] } : { view: 'home' };
}

function loadMe() {
  try { return localStorage.getItem(ME_KEY); } catch { return null; }
}
function saveMe(id) {
  try { id ? localStorage.setItem(ME_KEY, id) : localStorage.removeItem(ME_KEY); } catch { /* ignoré */ }
}

// ---------- données ----------

let loadSeq = 0;

async function load() {
  // Si deux rechargements se chevauchent, seul le plus récent met à jour l'écran.
  const seq = ++loadSeq;
  try {
    const r = route();
    const [people, gifts, mine, feed] = await Promise.all([
      state.store.listPeople(),
      state.me && r.view === 'list' ? state.store.listGifts(r.id) : state.gifts,
      state.me && r.view === 'home' ? state.store.listMyContributions(state.me) : state.mine,
      state.me && r.view === 'home' ? state.store.listAllGifts() : state.feed,
    ]);
    if (seq !== loadSeq) return;
    Object.assign(state, { people, gifts, mine, feed });
    if (state.me && !person(state.me)) { state.me = null; saveMe(null); }
  } catch (e) {
    if (seq !== loadSeq) return;
    showFlash(e.message, true);
  }
  state.loading = false;
  render();
}

async function act(fn, successMsg) {
  try {
    await fn();
    showFlash(successMsg);
  } catch (e) {
    showFlash(e.message, true);
  }
  await load();
}

function showFlash(msg, error = false) {
  const flash = { msg, error };
  state.flash = flash;
  setTimeout(() => {
    if (state.flash !== flash) return;
    state.flash = null;
    document.querySelector('.flash')?.remove(); // sans re-rendu, pour ne pas vider un formulaire en cours
  }, 4000);
}

// ---------- vues ----------

function render() {
  const r = route();
  let body;
  if (state.loading) body = '<p class="muted center">Chargement…</p>';
  else if (!state.me) body = viewLogin();
  else if (r.view === 'list' && person(r.id)) body = r.id === state.me ? viewMyList() : viewTheirList(person(r.id));
  else body = viewHome();

  const flash = state.flash ? `<div class="flash${state.flash.error ? ' error' : ''}" role="status">${esc(state.flash.msg)}</div>` : '';
  app.innerHTML = header() + flash + body;
}

function header() {
  const demo = state.store?.demo ? '<span class="demo" title="Les données restent dans ce navigateur">mode démo</span>' : '';
  const me = state.me
    ? `<div class="me">${bubble(state.me)}<button class="link" data-action="logout">Changer</button></div>`
    : '';
  return `<header><a href="#/" class="brand">🎁 Nos listes de cadeaux</a>${demo}${me}</header>`;
}

function viewLogin() {
  const people = state.people.map((p) => `
    <button class="person" data-action="login" data-id="${p.id}" style="--c:${colorOf(p.id)}">
      ${avatar(p.id, true)}${esc(p.name)}
    </button>`).join('');
  return `
    <section class="card">
      <h1>Qui es-tu ?</h1>
      <p class="muted">${state.people.length ? 'Clique sur ton prénom.' : 'Commence par ajouter les prénoms de la famille.'}</p>
      <div class="people">${people}</div>
      <form data-form="add-person" class="inline">
        <input name="name" placeholder="Ajouter un prénom" maxlength="40" required autocomplete="off">
        <button>Ajouter</button>
      </form>
    </section>`;
}

function viewHome() {
  const me = person(state.me);
  const others = state.people.filter((p) => p.id !== state.me);
  const card = (p, label) => `
    <a class="person" href="#/liste/${p.id}" style="--c:${colorOf(p.id)}">
      ${avatar(p.id, true)}${esc(label ?? p.name)}
    </a>`;

  const mine = state.mine.filter((c) => c.gift).map((c) => `
    <li>
      <span class="swatch cat-${c.gift.category}"></span>
      <a href="#/liste/${c.gift.owner_id}">${esc(c.gift.title)}</a>
      <span class="muted">pour ${esc(person(c.gift.owner_id)?.name)} · ${OCCASIONS[c.occasion] ?? ''}${c.gift.category === 'gros' ? ` · ma part : ${c.percent} %` : ''}</span>
    </li>`).join('');

  return `
    <section class="card">
      <h1>Bonjour ${esc(me.name)} 👋</h1>
      <div class="people">${card(me, 'Ma liste')}${photoPicker()}</div>
    </section>
    <section class="card">
      <h2>Les listes de la famille</h2>
      <div class="people">${others.map((p) => card(p)).join('') || '<p class="muted">Personne d’autre pour l’instant.</p>'}</div>
      <form data-form="add-person" class="inline">
        <input name="name" placeholder="Ajouter un membre de la famille" maxlength="40" required autocomplete="off">
        <button>Ajouter</button>
      </form>
    </section>
    <section class="card">
      <h2>Ce que j’offre</h2>
      ${mine ? `<ul class="mine">${mine}</ul>` : '<p class="muted">Tu ne t’es encore positionné·e sur aucun cadeau.</p>'}
    </section>
    <section>
      <h2 class="feed-title">Toutes les envies de la famille</h2>
      <p class="muted">Les dernières demandes en premier.</p>
      ${state.feed.map(feedGift).join('') || '<p class="muted center">Personne n’a encore ajouté de cadeau.</p>'}
    </section>`;
}

function feedGift(g) {
  const head = `
    <div class="owner-line">
      <a href="#/liste/${g.owner_id}" title="Voir toute sa liste">${bubble(g.owner_id)}</a>
      <span class="muted">${shortDate(g.created_at)}</span>
    </div>`;
  if (g.owner_id === state.me) {
    return `<article class="gift cat-${g.category}">${head}${giftBody(g)}<p class="muted">C’est ta demande 🤫</p></article>`;
  }
  return theirGift(g, head);
}

function giftForm(g) {
  const cats = Object.entries(CATS).map(([k, label]) => `
    <label class="cat-pick cat-${k}">
      <input type="radio" name="category" value="${k}" required ${g?.category === k ? 'checked' : ''}>
      <span><span class="swatch"></span>${label}</span>
    </label>`).join('');
  return `
    <form data-form="gift" data-id="${g?.id ?? ''}" class="gift-form">
      <input name="title" placeholder="Nom du cadeau" maxlength="200" required value="${esc(g?.title)}">
      <textarea name="description" placeholder="Description (facultatif)" maxlength="2000" rows="2">${esc(g?.description)}</textarea>
      <input name="link" placeholder="Lien (facultatif)" maxlength="2000" value="${esc(g?.link)}">
      <label class="price-field">
        <input name="price" type="number" inputmode="decimal" min="0" max="99999" step="0.01" placeholder="Prix indicatif (facultatif)" value="${g && hasPrice(g) ? esc(g.price) : ''}">
        <span>€</span>
      </label>
      <div class="cats">${cats}</div>
      <div class="actions">
        <button class="primary">${g ? 'Enregistrer' : 'Ajouter à ma liste'}</button>
        ${g ? '<button type="button" data-action="cancel-edit">Annuler</button>' : ''}
      </div>
    </form>`;
}

function giftBody(g) {
  const url = safeUrl(g.link);
  return `
    <div class="gift-head">
      <span class="tag cat-${g.category}"><span class="swatch"></span>${CATS[g.category]}</span>
      ${hasPrice(g) ? `<span class="price" title="Prix indicatif">≈ ${EUROS.format(Number(g.price))}</span>` : ''}
    </div>
    <h3>${esc(g.title)}</h3>
    ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ''}
    ${url ? `<a class="ext" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Voir le lien ↗</a>` : ''}`;
}

function sections(renderGift) {
  const html = Object.entries(CATS).map(([k, label]) => {
    const list = state.gifts.filter((g) => g.category === k);
    if (!list.length) return '';
    return `<section class="cat-section"><h2 class="cat-title cat-${k}"><span class="swatch"></span>${label} <span class="muted">(${list.length})</span></h2>${list.map(renderGift).join('')}</section>`;
  }).join('');
  return html || '<p class="muted center">Aucun cadeau dans cette liste pour le moment.</p>';
}

function viewMyList() {
  const myGift = (g) => state.editingId === g.id
    ? `<article class="gift cat-${g.category}">${giftForm(g)}</article>`
    : `<article class="gift cat-${g.category}">${giftBody(g)}
        <div class="actions">
          <button data-action="edit" data-id="${g.id}">Modifier</button>
          <button class="danger" data-action="delete" data-id="${g.id}">Supprimer</button>
        </div>
      </article>`;
  return `
    <section class="card">
      <h1>Ma liste</h1>
      <p class="muted">Tu ne vois pas qui t’offre quoi : c’est la surprise 🤫</p>
      <div class="people">${photoPicker()}</div>
      ${giftForm(null)}
    </section>
    ${sections(myGift)}`;
}

function viewTheirList(owner) {
  return `
    <section class="card">
      <h1>La liste de ${esc(owner.name)}</h1>
      <p class="muted">Clique sur « Je l’offre » pour réserver un cadeau. Les gros cadeaux peuvent être partagés.</p>
    </section>
    ${sections(theirGift)}`;
}

function theirGift(g, head = '') {
  const contribs = g.contributions ?? [];
  const total = contribs.reduce((sum, c) => sum + c.percent, 0);
  const mine = contribs.find((c) => c.person_id === state.me);
  const remaining = Math.max(0, 100 - total);
  let status = '';
  let actions = '';

  if (g.category !== 'gros') {
    if (!contribs.length || mine) {
      actions = `
        <form data-form="offer" data-id="${g.id}" class="share">
          ${occasionSelect(mine?.occasion)}
          ${mine ? '<button>Changer l’occasion</button>' : '<button class="primary">Je l’offre</button>'}
        </form>`;
    }
    if (contribs.length) {
      status = `<div class="givers"><span class="muted">Offert par</span>${contribs.map((c) => bubble(c.person_id, OCCASIONS[c.occasion])).join('')}</div>`;
      if (mine) actions += `<button data-action="withdraw" data-id="${g.id}">Je ne l’offre plus</button>`;
    }
  } else {
    status = `
      <div class="progress" aria-label="${total} % financé"><span style="width:${Math.min(total, 100)}%"></span></div>
      <div class="progress-label">${total} % financé${remaining ? ` · reste ${remaining} %${shareOf(g, remaining)}` : ' ✅'}</div>
      ${contribs.length ? `<div class="givers">${contribs.map((c) => bubble(c.person_id, `${c.percent} %${shareOf(g, c.percent)} · ${OCCASIONS[c.occasion]}`)).join('')}</div>` : ''}`;
    const max = remaining + (mine?.percent ?? 0);
    if (max > 0) {
      actions = `
        <form data-form="share" data-id="${g.id}" class="share">
          <input type="number" name="percent" min="1" max="${max}" value="${mine ? mine.percent : remaining}" required aria-label="Pourcentage"> %
          ${occasionSelect(mine?.occasion)}
          <button class="primary">${mine ? 'Modifier ma part' : 'Je participe'}</button>
        </form>`;
    }
    if (mine) actions += `<button data-action="withdraw" data-id="${g.id}">Me retirer</button>`;
  }

  const taken = g.category === 'gros' ? total >= 100 : contribs.length > 0;
  return `<article class="gift cat-${g.category}${taken ? ' taken' : ''}">${head}${giftBody(g)}${status}<div class="actions">${actions}</div></article>`;
}

// ---------- événements ----------

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'login') { state.me = id; saveMe(id); location.hash = '#/'; load(); }
  if (action === 'logout') { state.me = null; saveMe(null); location.hash = '#/'; render(); }
  if (action === 'edit') { state.editingId = id; render(); }
  if (action === 'cancel-edit') { state.editingId = null; render(); }
  if (action === 'delete' && confirm('Supprimer ce cadeau ?')) act(() => state.store.deleteGift(id), 'Cadeau supprimé');
  if (action === 'withdraw') act(() => state.store.withdraw(id, state.me), 'Tu ne participes plus à ce cadeau');
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  for (const b of form.querySelectorAll('button')) b.disabled = true;

  if (form.dataset.form === 'add-person') {
    const name = data.name.trim();
    act(() => state.store.addPerson(name), `${name} a été ajouté·e`);
  }
  if (form.dataset.form === 'gift') {
    const gift = {
      title: data.title.trim(),
      description: data.description.trim() || null,
      link: data.link.trim() || null,
      price: data.price === '' ? null : Number(data.price),
      category: data.category,
    };
    if (form.dataset.id) gift.id = form.dataset.id;
    else gift.owner_id = state.me;
    act(async () => { await state.store.saveGift(gift); state.editingId = null; }, gift.id ? 'Cadeau modifié' : 'Cadeau ajouté');
  }
  if (form.dataset.form === 'offer') {
    act(() => state.store.contribute(form.dataset.id, state.me, 100, data.occasion), 'C’est noté, tu offres ce cadeau 🎉');
  }
  if (form.dataset.form === 'share') {
    act(() => state.store.contribute(form.dataset.id, state.me, parseInt(data.percent, 10), data.occasion), 'Ta participation est enregistrée');
  }
});

app.addEventListener('change', (e) => {
  const input = e.target;
  if (input.dataset.change !== 'avatar' || !input.files?.[0]) return;
  const file = input.files[0];
  input.closest('.photo-pick')?.classList.add('busy');
  act(async () => state.store.setAvatar(state.me, await squareJpeg(file)), 'Ta photo est enregistrée 📸');
});

window.addEventListener('hashchange',() => { state.editingId = null; load(); });

// Quand on revient sur l'onglet, on recharge pour voir ce que les autres ont réservé entre-temps.
window.addEventListener('focus', () => {
  if (!app.contains(document.activeElement) || !document.activeElement.matches('input, textarea')) load();
});

try {
  state.store = await createStore(window.CADEAUX_CONFIG ?? {});
  state.me = loadMe();
  await load();
} catch (e) {
  app.innerHTML = `<p class="flash error">Impossible de charger le site : ${esc(e.message)}</p>`;
}
