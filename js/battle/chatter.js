// Battle chatter: short shouted lines in English (Americans) and German (Germans), shown as subtitles.
// Rate-limited so the field stays readable.
const LINES = {
  allies: {
    contact: ['Contact front!', 'Enemy spotted!', 'Krauts, up ahead!', 'I see \'em!', 'Jerries, twelve o\'clock!', 'Contact!'],
    contactMG: ['MG forty-two! Get down!', 'Machine gun! Take cover!'],
    reload: ['Reloading!', 'Cover me, I\'m reloading!', 'Changing mags!', 'Gotta reload!'],
    grenade: ['Grenade!', 'Potato masher! Get down!', 'Grenade! Move!'],
    throw: ['Fire in the hole!', 'Frag out!', 'Grenade out!'],
    kill: ['Got him!', 'Kraut down!', 'He\'s down!', 'Scratch one!', 'Got one!'],
    manDown: ['Man down!', 'Medic!', '{name}\'s hit!', 'They got {name}!'],
    hit: ['I\'m hit!', 'Agh! I\'m hit!', 'Medic!'],
    incoming: ['Incoming!', 'Artillery! Hit the dirt!', 'Incoming! Get down!'],
    pinned: ['I\'m pinned down!', 'Keep your heads down!', 'They\'ve got us pinned!'],
    hold: ['Holding here, sir.', 'We\'ll hold.', 'Right here, Lieutenant.'],
    follow: ['Right behind you, sir.', 'On you, Lieutenant.', 'Moving up!'],
    attack: ['Go, go, go!', 'Move up! Move up!', 'Let\'s go! Move!'],
  },
  axis: {
    contact: ['Feindkontakt!', 'Amerikaner!', 'Da drüben!', 'Achtung, Feind!', 'Da sind sie!'],
    contactMG: ['Feindkontakt!'],
    reload: ['Nachladen!', 'Gebt mir Deckung!', 'Magazin wechseln!'],
    grenade: ['Granate!', 'Handgranate! Deckung!', 'Granate! Weg hier!'],
    throw: ['Handgranate!', 'Granate raus!'],
    kill: ['Treffer!', 'Er ist tot!', 'Den hab ich!'],
    manDown: ['Sanitäter!', 'Mann getroffen!', 'Sie haben {name} erwischt!'],
    hit: ['Ich bin getroffen!', 'Sanitäter!', 'Ah, mein Arm!'],
    incoming: ['Artillerie! Volle Deckung!', 'Deckung!', 'Runter!'],
    pinned: ['Kopf runter!', 'Ich komme nicht raus!', 'Die haben uns festgenagelt!'],
    suspicious: ['Wer da?', 'Halt! Wer ist da?', 'Hallo? Ist da jemand?', 'Was war das?', 'Hast du das gehört?'],
    alarm: ['Alarm! Alarm!', 'Alarm! Amerikaner!', 'Feind im Abschnitt! Alarm!'],
    attack: ['Vorwärts!', 'Los, los!', 'Angriff!'],
  },
};
// lines that cut across whatever is being said
const URGENT = new Set(['grenade', 'incoming', 'alarm']);
const KIND_CD = { contact: 5, contactMG: 8, reload: 4, grenade: 2.5, throw: 3, kill: 4, manDown: 4, hit: 3, incoming: 6, pinned: 10, suspicious: 4, alarm: 8, hold: 0, follow: 0, attack: 10 };

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Chatter {
  constructor(battle) {
    this.b = battle;
    this.mode = localStorage.getItem('rtb.chatter') === 'off' ? 'off' : 'subs';
    this.lastT = -99; this.kindT = {};
  }
  // speaker: a Bot (or the player's Ranger), kind: line category; opts.name fills {name}
  say(sp, kind, opts = {}) {
    if (this.mode === 'off' || !sp) return false;
    const b = this.b, now = b.time;
    const lines = LINES[sp.team] && LINES[sp.team][kind];
    if (!lines) return false;
    const urgent = URGENT.has(kind);
    if (!urgent && now - this.lastT < 1.4) return false;
    if (now - (this.kindT[sp.team + kind] ?? -99) < (KIND_CD[kind] ?? 4)) return false;
    if (!opts.force && now - (sp._chatT ?? -99) < 5) return false;
    // only what you could hear: nearby soldiers, or your own squad within shouting distance
    const cam = b.camera.position, d = Math.hypot(sp.pos.x - cam.x, sp.pos.z - cam.z);
    const squad = sp.role === 'follow';
    const range = squad ? 90 : urgent ? 70 : 55;
    if (d > range) return false;
    this.lastT = now; this.kindT[sp.team + kind] = now; sp._chatT = now;
    let text = pick(lines);
    if (text.includes('{name}')) { const n = opts.name ? opts.name.split(' ').pop() : null; text = n ? text.replace('{name}', n) : pick(lines.filter((l) => !l.includes('{name}'))); }
    if (b.hud && b.hud.chat && d < 45) b.hud.chat(sp.name || '', text, sp.team === b.playerTeam);
    return true;
  }
  // nearest living soldier of `team` to a point (for reactions)
  nearest(team, x, z, maxD, exclude) {
    let best = null, bd = maxD;
    for (const o of this.b.bots) {
      if (!o.alive || o.team !== team || o === exclude || o.role === 'captive') continue;
      const d = Math.hypot(o.pos.x - x, o.pos.z - z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  stop() {}
}
