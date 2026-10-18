// Accès aux données : Supabase si configuré, sinon un mode démo qui garde tout dans ce navigateur.

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';

export async function createStore(cfg) {
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) return supabaseStore(cfg);
  return demoStore();
}

function frenchError(error) {
  if (error.code === '23505') return 'Ce prénom existe déjà';
  if (error.code === '23503') return "Ce cadeau n'existe plus";
  if (error.code === 'P0001') return error.message; // messages levés par le trigger, déjà en français
  return 'Oups, une erreur est survenue : ' + error.message;
}

async function supabaseStore(cfg) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
  const check = ({ data, error }) => {
    if (error) throw new Error(frenchError(error));
    return data;
  };

  return {
    demo: false,
    listPeople: async () =>
      check(await sb.from('people').select('id, name, avatar_url').order('name')),
    addPerson: async (name) =>
      check(await sb.from('people').insert({ name }).select('id, name').single()),
    setAvatar: async (personId, blob) => {
      const path = `${personId}.jpg`;
      check(await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }));
      // Le paramètre v force les navigateurs à recharger la photo quand elle change.
      const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      check(await sb.from('people').update({ avatar_url: url }).eq('id', personId));
    },
    listGifts: async (ownerId) =>
      check(await sb.from('gifts')
        .select('*, contributions(person_id, percent, occasion, created_at)')
        .eq('owner_id', ownerId)
        .order('created_at')),
    listAllGifts: async () =>
      check(await sb.from('gifts')
        .select('*, contributions(person_id, percent, occasion, created_at)')
        .order('created_at', { ascending: false })
        .limit(300)),
    listMyContributions: async (personId) =>
      check(await sb.from('contributions')
        .select('percent, occasion, gift:gifts(id, title, category, owner_id)')
        .eq('person_id', personId)
        .order('created_at')),
    saveGift: async ({ id, ...fields }) =>
      check(id
        ? await sb.from('gifts').update(fields).eq('id', id)
        : await sb.from('gifts').insert(fields)),
    deleteGift: async (id) =>
      check(await sb.from('gifts').delete().eq('id', id)),
    contribute: async (giftId, personId, percent, occasion) =>
      check(await sb.from('contributions')
        .upsert({ gift_id: giftId, person_id: personId, percent, occasion }, { onConflict: 'gift_id,person_id' })),
    withdraw: async (giftId, personId) =>
      check(await sb.from('contributions').delete().eq('gift_id', giftId).eq('person_id', personId)),
  };
}

// Mêmes règles que le trigger check_contribution de supabase/schema.sql.
function validateContribution(gift, contributions, personId, percent) {
  if (gift.owner_id === personId) throw new Error("Tu ne peux pas t'offrir ton propre cadeau");
  const others = contributions
    .filter((c) => c.gift_id === gift.id && c.person_id !== personId)
    .reduce((sum, c) => sum + c.percent, 0);
  if (gift.category !== 'gros') {
    if (others > 0) throw new Error("Quelqu'un offre déjà ce cadeau");
    return 100;
  }
  if (!(percent >= 1 && percent <= 100)) throw new Error('Choisis un pourcentage entre 1 et 100');
  if (others >= 100) throw new Error('Ce cadeau est déjà entièrement financé');
  if (others + percent > 100) throw new Error(`Il ne reste que ${100 - others} % à financer pour ce cadeau`);
  return percent;
}

function demoStore() {
  const KEY = 'cadeaux.demo';
  let memory = { people: [], gifts: [], contributions: [] };
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || memory; } catch { return memory; }
  };
  const write = (db) => {
    memory = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* mode privé : on garde en mémoire */ }
  };
  const now = () => new Date().toISOString();

  return {
    demo: true,
    listPeople: async () =>
      read().people.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    addPerson: async (name) => {
      const db = read();
      if (db.people.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())) {
        throw new Error('Ce prénom existe déjà');
      }
      const p = { id: crypto.randomUUID(), name };
      db.people.push(p);
      write(db);
      return p;
    },
    setAvatar: async (personId, blob) => {
      const db = read();
      const p = db.people.find((x) => x.id === personId);
      if (!p) throw new Error("Cette personne n'existe plus");
      p.avatar_url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Impossible de lire la photo'));
        reader.readAsDataURL(blob);
      });
      write(db);
    },
    listGifts: async (ownerId) => {
      const db = read();
      return db.gifts
        .filter((g) => g.owner_id === ownerId)
        .map((g) => ({ ...g, contributions: db.contributions.filter((c) => c.gift_id === g.id) }));
    },
    listAllGifts: async () => {
      const db = read();
      return db.gifts
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((g) => ({ ...g, contributions: db.contributions.filter((c) => c.gift_id === g.id) }));
    },
    listMyContributions: async (personId) => {
      const db = read();
      return db.contributions
        .filter((c) => c.person_id === personId)
        .map((c) => ({ percent: c.percent, occasion: c.occasion, gift: db.gifts.find((g) => g.id === c.gift_id) }));
    },
    saveGift: async ({ id, ...fields }) => {
      const db = read();
      if (id) {
        const g = db.gifts.find((x) => x.id === id);
        if (!g) throw new Error("Ce cadeau n'existe plus");
        Object.assign(g, fields);
      } else {
        db.gifts.push({ id: crypto.randomUUID(), created_at: now(), ...fields });
      }
      write(db);
    },
    deleteGift: async (id) => {
      const db = read();
      db.gifts = db.gifts.filter((g) => g.id !== id);
      db.contributions = db.contributions.filter((c) => c.gift_id !== id);
      write(db);
    },
    contribute: async (giftId, personId, percent, occasion) => {
      const db = read();
      const gift = db.gifts.find((g) => g.id === giftId);
      if (!gift) throw new Error("Ce cadeau n'existe plus");
      const value = validateContribution(gift, db.contributions, personId, percent);
      const existing = db.contributions.find((c) => c.gift_id === giftId && c.person_id === personId);
      if (existing) Object.assign(existing, { percent: value, occasion });
      else db.contributions.push({ gift_id: giftId, person_id: personId, percent: value, occasion, created_at: now() });
      write(db);
    },
    withdraw: async (giftId, personId) => {
      const db = read();
      db.contributions = db.contributions.filter((c) => !(c.gift_id === giftId && c.person_id === personId));
      write(db);
    },
  };
}
