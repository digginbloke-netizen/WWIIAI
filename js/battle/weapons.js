// Weapon and class definitions.

export const CLASSES = {
  rifleman: { label: 'Rifleman', desc: 'Accurate semi-automatic / bolt rifle. 3 grenades.', grenades: 3 },
  assault:  { label: 'Assault',  desc: 'Submachine gun for close quarters. 2 grenades.', grenades: 2 },
  support:  { label: 'Support',  desc: 'Light / general purpose machine gun. 1 grenade.', grenades: 1 },
  sniper:   { label: 'Sniper',   desc: 'Scoped bolt-action rifle for long shots. 1 grenade.', grenades: 1, unlock: 'springfield' },
  bazooka:  { label: 'Anti-tank', desc: 'Rocket launcher: wrecks trucks, guns and dumps from range. 1 grenade.', grenades: 1, unlock: 'bazooka' },
};

// per team weapon stats
export const WEAPONS = {
  allies: {
    rifleman: { name: 'M1 Garand', sound: 'rifle', dmg: 58, rof: 0.16, mag: 8, reserve: 64, auto: false, spread: 0.004, moveSpread: 0.03, recoil: 0.026, reload: 2.2, range: 300, color: 0x5a4028 },
    assault:  { name: 'Thompson',  sound: 'smg',   dmg: 26, rof: 0.085, mag: 30, reserve: 150, auto: true, spread: 0.018, moveSpread: 0.03, recoil: 0.011, reload: 2.6, range: 110, color: 0x3a2c22 },
    support:  { name: 'BAR',       sound: 'lmg',   dmg: 40, rof: 0.12, mag: 20, reserve: 140, auto: true, spread: 0.011, moveSpread: 0.05, recoil: 0.02, reload: 3.0, range: 240, color: 0x4a3a28 },
    sniper:   { name: 'M1903A4 Springfield', sound: 'bolt', dmg: 125, rof: 1.25, mag: 5, reserve: 45, auto: false, spread: 0.0012, moveSpread: 0.05, recoil: 0.05, reload: 3.0, range: 500, scope: true },
    bazooka:  { name: 'M1A1 Bazooka', sound: 'rocket', dmg: 0, rof: 1.2, mag: 1, reserve: 5, auto: false, spread: 0.008, moveSpread: 0.03, recoil: 0.03, reload: 3.4, range: 300, rocket: true },
  },
  axis: {
    rifleman: { name: 'Kar98k',    sound: 'bolt',  dmg: 95, rof: 1.05, mag: 5, reserve: 50, auto: false, spread: 0.003, moveSpread: 0.035, recoil: 0.045, reload: 2.6, range: 320, color: 0x5a4028 },
    assault:  { name: 'MP40',      sound: 'smg',   dmg: 25, rof: 0.1, mag: 32, reserve: 160, auto: true, spread: 0.017, moveSpread: 0.03, recoil: 0.01, reload: 2.5, range: 110, color: 0x222222 },
    support:  { name: 'MG42',      sound: 'lmg',   dmg: 32, rof: 0.055, mag: 50, reserve: 200, auto: true, spread: 0.016, moveSpread: 0.06, recoil: 0.014, reload: 4.0, range: 240, color: 0x2a2a2a },
  },
};

export const GRENADE = { fuse: 3.2, radius: 7.5, dmg: 150 };

export const DIFFICULTY = {
  easy:    { acc: 0.55, react: 0.75, dmgToPlayer: 0.6 },
  normal:  { acc: 0.8,  react: 0.5,  dmgToPlayer: 0.85 },
  hard:    { acc: 1.0,  react: 0.35, dmgToPlayer: 1.0 },
};
