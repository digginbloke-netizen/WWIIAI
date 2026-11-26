// Strategic map definition: a schematic Western Front, June 1944.
// Coordinates are in a 1000 x 700 map space.

export const MAP_W = 1000;
export const MAP_H = 700;

// Sea polygon (Channel, North Sea, Bay of Biscay)
export const SEA = [
  [0, 0], [760, 0], [700, 62], [640, 48], [590, 40], [545, 62], [505, 98], [455, 128], [420, 150],
  [385, 170], [345, 238], [305, 278], [252, 300], [200, 296], [165, 282], [150, 262], [112, 262],
  [100, 300], [82, 345], [22, 375], [55, 470], [115, 560], [128, 700], [0, 700],
];
// England sits inside the sea polygon
export const ENGLAND = [
  [20, 40], [120, 18], [205, 22], [262, 92], [255, 160], [222, 200], [150, 214], [62, 220], [12, 196],
];

export const TERRAIN_INFO = {
  beach:    { label: 'Coastline',  def: 1.15, icon: '≈' },
  farmland: { label: 'Bocage',     def: 1.2,  icon: '▤' },
  town:     { label: 'Town',       def: 1.35, icon: '▣' },
  city:     { label: 'City',       def: 1.5,  icon: '▦' },
  forest:   { label: 'Forest',     def: 1.4,  icon: '♣' },
  hills:    { label: 'Hills',      def: 1.35, icon: '▲' },
};

// owner: 'allies' | 'axis'. troops are abstract battalion-strength points.
// value: supply value (income). port: Allied supply source when held.
// homeland: Axis supply source.
export const REGIONS = [
  { id: 'eng',  name: 'Southern England', x: 140, y: 120, terrain: 'city',     owner: 'allies', troops: 0,  value: 0, hq: true },
  { id: 'nbch', name: 'Normandy Beaches', x: 200, y: 330, terrain: 'beach',    owner: 'axis',   troops: 32, value: 2, port: true },
  { id: 'cher', name: 'Cherbourg',        x: 122, y: 305, terrain: 'town',     owner: 'axis',   troops: 30, value: 3, port: true },
  { id: 'caen', name: 'Caen',             x: 268, y: 340, terrain: 'town',     owner: 'axis',   troops: 46, value: 3 },
  { id: 'brit', name: 'Brittany',         x: 70,  y: 405, terrain: 'farmland', owner: 'axis',   troops: 24, value: 2, port: true },
  { id: 'stlo', name: 'Saint-Lô',         x: 170, y: 395, terrain: 'farmland', owner: 'axis',   troops: 34, value: 2 },
  { id: 'fal',  name: 'Falaise',          x: 268, y: 420, terrain: 'farmland', owner: 'axis',   troops: 36, value: 2 },
  { id: 'lem',  name: 'Le Mans',          x: 205, y: 495, terrain: 'farmland', owner: 'axis',   troops: 22, value: 2 },
  { id: 'rou',  name: 'Rouen',            x: 345, y: 300, terrain: 'town',     owner: 'axis',   troops: 30, value: 3 },
  { id: 'cal',  name: 'Pas-de-Calais',    x: 395, y: 205, terrain: 'beach',    owner: 'axis',   troops: 48, value: 3, port: true },
  { id: 'par',  name: 'Paris',            x: 400, y: 395, terrain: 'city',     owner: 'axis',   troops: 40, value: 6 },
  { id: 'orl',  name: 'Orléans',          x: 330, y: 520, terrain: 'farmland', owner: 'axis',   troops: 20, value: 2 },
  { id: 'rei',  name: 'Reims',            x: 500, y: 360, terrain: 'farmland', owner: 'axis',   troops: 26, value: 2 },
  { id: 'bru',  name: 'Brussels',         x: 520, y: 235, terrain: 'city',     owner: 'axis',   troops: 34, value: 4 },
  { id: 'ant',  name: 'Antwerp',          x: 470, y: 168, terrain: 'town',     owner: 'axis',   troops: 30, value: 4, port: true },
  { id: 'ard',  name: 'Ardennes',         x: 585, y: 305, terrain: 'forest',   owner: 'axis',   troops: 30, value: 1 },
  { id: 'met',  name: 'Metz',             x: 595, y: 425, terrain: 'hills',    owner: 'axis',   troops: 36, value: 3 },
  { id: 'nan',  name: 'Nancy',            x: 520, y: 480, terrain: 'farmland', owner: 'axis',   troops: 22, value: 2 },
  { id: 'lyo',  name: 'Lyon',             x: 470, y: 610, terrain: 'town',     owner: 'axis',   troops: 26, value: 3 },
  { id: 'als',  name: 'Alsace',           x: 655, y: 545, terrain: 'hills',    owner: 'axis',   troops: 34, value: 2 },
  { id: 'rot',  name: 'Rotterdam',        x: 540, y: 118, terrain: 'town',     owner: 'axis',   troops: 28, value: 3, port: true },
  { id: 'arn',  name: 'Arnhem',           x: 625, y: 135, terrain: 'town',     owner: 'axis',   troops: 32, value: 2 },
  { id: 'aac',  name: 'Aachen',           x: 650, y: 240, terrain: 'town',     owner: 'axis',   troops: 33, value: 3, homeland: true },
  { id: 'hur',  name: 'Hürtgen Forest',   x: 690, y: 305, terrain: 'forest',   owner: 'axis',   troops: 32, value: 1, homeland: true },
  { id: 'sar',  name: 'Saarland',         x: 690, y: 420, terrain: 'hills',    owner: 'axis',   troops: 28, value: 3, homeland: true },
  { id: 'col',  name: 'Cologne',          x: 740, y: 225, terrain: 'city',     owner: 'axis',   troops: 34, value: 4, homeland: true },
  { id: 'ruh',  name: 'Ruhr',             x: 765, y: 145, terrain: 'city',     owner: 'axis',   troops: 39, value: 7, homeland: true },
  { id: 'fra',  name: 'Frankfurt',        x: 800, y: 340, terrain: 'city',     owner: 'axis',   troops: 33, value: 5, homeland: true },
  { id: 'stu',  name: 'Stuttgart',        x: 780, y: 490, terrain: 'hills',    owner: 'axis',   troops: 27, value: 4, homeland: true },
  { id: 'han',  name: 'Hanover',          x: 860, y: 120, terrain: 'farmland', owner: 'axis',   troops: 28, value: 3, homeland: true },
  { id: 'kas',  name: 'Kassel',           x: 880, y: 250, terrain: 'forest',   owner: 'axis',   troops: 28, value: 3, homeland: true },
  { id: 'mun',  name: 'Munich',           x: 905, y: 565, terrain: 'city',     owner: 'axis',   troops: 33, value: 5, homeland: true },
  { id: 'nur',  name: 'Nuremberg',        x: 900, y: 420, terrain: 'town',     owner: 'axis',   troops: 30, value: 4, homeland: true },
  { id: 'lei',  name: 'Leipzig',          x: 965, y: 300, terrain: 'city',     owner: 'axis',   troops: 33, value: 5, homeland: true },
  { id: 'ber',  name: 'Berlin',           x: 970, y: 150, terrain: 'city',     owner: 'axis',   troops: 80, value: 8, homeland: true, capital: true },
];

// Sea lanes for amphibious assaults from England
export const SEA_LINKS = [['eng', 'nbch'], ['eng', 'cher'], ['eng', 'cal']];

export const WEATHER = {
  clear:    { label: 'Clear',    fog: 0.004, air: true },
  overcast: { label: 'Overcast', fog: 0.007, air: true },
  rain:     { label: 'Rain',     fog: 0.011, air: false },
  fog:      { label: 'Fog',      fog: 0.024, air: false },
  snow:     { label: 'Snow',     fog: 0.013, air: false },
};

// Enemy assets Rangers can destroy in a sector. Effects are applied to the war effort
// whether or not the asset was the mission's primary objective.
export const ASSET_TYPES = {
  artillery: { label: 'Artillery battery', icon: '✸', effect: 'Strips the sector of artillery support and one level of fortification.' },
  flak:      { label: 'Flak battery',      icon: '✈', effect: 'Opens the sky: Allied air support hits this sector hard this week.' },
  fuel:      { label: 'Fuel depot',        icon: '◉', effect: 'No German counterattack can be launched from this sector; −15 enemy supplies.' },
  ammo:      { label: 'Ammunition dump',   icon: '▣', effect: 'Garrison loses 12 troops’ worth of firepower.' },
  radio:     { label: 'Command post',      icon: '☎', effect: 'Enemy defense here is disorganised (−15%) and cannot counterattack.' },
  trucks:    { label: 'Truck park',        icon: '▬', effect: 'Disrupts German logistics: −10 enemy manpower and −10 supplies.' },
  tank:      { label: 'Panzer laager',     icon: '◆', effect: 'Destroys armored reserves: −15 enemy troops in the sector.' },
};
