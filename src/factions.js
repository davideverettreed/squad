'use strict';
// Forces of other times and places, and the scenarios that set them against each other.
// Each force gives its organization, weapons and way of fighting; the enemy is built from
// one, and so is the player's own side when it is not today's Marine squad.

// Variants of weapons in data.js under the names a force knew them by.
WEAPONS.AKS74 = Object.assign({}, WEAPONS.AK74, { name: 'AKS-74' });
WEAPONS.RPKS74 = Object.assign({}, WEAPONS.RPK74, { name: 'RPKS-74' });
WEAPONS.AKMS = Object.assign({}, WEAPONS.AKM, { name: 'AKMS' });
WEAPONS.AK74M = Object.assign({}, WEAPONS.AK74, { name: 'AK-74M' });
WEAPONS.K98K = Object.assign({}, WEAPONS.GEW98, { name: 'Mauser Kar98k', r50: 260 });
WEAPONS.PISTOL = { name: 'Flintlock pistol', rounds: 1, cycle: 1, acc: 0.25, r50: 15, range: 30, dmg: 1.2, supp: 4, mag: 1, mags: 9, reload: 20, kg: 1.2, magType: 'ball', smoke: true };

// Surnames for the men of the player's side in other eras.
const ERA_NAMES = {
  colonial: ['Brown', 'Church', 'Mason', 'Bourne', 'Salisbury', 'Cole', 'Hale', 'Gorham', 'Willett', 'Bowen', 'Paine', 'Thurston',
    'Mann', 'Peck', 'Jenckes', 'Wheaton', 'Bullock', 'Cushing', 'Bradford', 'Southworth', 'Howland', 'Fuller', 'Winslow', 'Cooke',
    'Barnes', 'Sabin', 'Read', 'Carpenter', 'Ide', 'Walker', 'Thomas', 'Allen', 'Rogers', 'Kingsley', 'Luther', 'Cranston', 'Martin'],
  continental: ['Allen', 'Ballard', 'Clark', 'Crane', 'Doane', 'Dunlap', 'Ellis', 'Fenton', 'Gibbs', 'Hart', 'Hubbell', 'Irvine', 'Ives',
    'Jameson', 'Judd', 'Knox', 'Lyman', 'Mead', 'Nash', 'Olcott', 'Porter', 'Reed', 'Starr', 'Tuttle', 'Upham', 'Vail', 'Wells',
    'Yates', 'Fleming', 'McKean', 'Gordon', 'Hardin', 'Shreve', 'Stoddard', 'Bissell', 'Talmadge', 'Webb', 'Hull', 'Meigs', 'Hay'],
  algerian: ['Ben Ali', 'Bouzid', 'Mansouri', 'Haddad', 'Belkacem', 'Saadi', 'Brahimi', 'Zerrouki', 'Messaoudi', 'Chérif', 'Boudiaf',
    'Amrani', 'Khelifa', 'Laïdi', 'Rahmani', 'Touati', 'Hamdi', 'Benaïssa', 'Djebbar', 'Ouali', 'Kaci', 'Larbi', 'Mebarki', 'Nouri',
    'Ziane', 'Guerfi', 'Hamlaoui', 'Benboulaïd', 'Chihani', 'Lamouri', 'Aouchria', 'Bouchemal', 'Meziani', 'Ferhat', 'Soltani'],
  afghan: ['Gul', 'Khan', 'Jan', 'Rahim', 'Wali', 'Nur', 'Shah', 'Akbar', 'Habib', 'Zaman', 'Karim', 'Qadir', 'Hamid', 'Sadiq', 'Nabi',
    'Rasul', 'Daud', 'Yusuf', 'Amin', 'Hakim', 'Malang', 'Sher', 'Faizullah', 'Ghulam', 'Bismillah', 'Wakil', 'Najib', 'Aziz', 'Panah'],
};

// Each force: label; nation (its side in the battle box); men (plural); unit (what the
// order's intelligence, or its friendly forces paragraph, says of it); doctrine (how its AI
// fights, DOCTRINES in ai.js); morale range; training (how much fire shakes it, 1 regular);
// skill (marksmanship, 1 a trained modern rifleman); grenade and frags. billets: role (the
// symbol and the man's part: SL TL R AR MG G RPG MM CO CR), title, rank, weapon (a key or
// a weighted list), launcher, melee, frags. leader and hq: the command. groups: its groups,
// templates of billet keys used in turn; or pool and groupSize for bands without a fixed
// organization. The player's forces have three teams (teamWord, teamName) and names.
const FORCES = {
  // ------------------------------------------------------------ the player's side in other eras
  usmc1994: {
    label: 'USMC rifle squad, 1994', side: 'blue', nation: 'United States', unitName: '1st Squad', men: 'Marines', year: 1994,
    unit: 'A Marine rifle squad of 1994: M16A2 rifles, an M249 SAW and an M203 in each fire team.',
    morale: 82, training: 0.85, skill: 1, grenade: 'M67', frags: 2, names: 'usmc',
    billets: {
      SL: { role: 'SL', title: 'Squad Leader', rank: 'Sgt', weapon: 'M16A2', melee: 'bayonet' },
      TL: { role: 'TL', title: 'Fire Team Leader', rank: 'Cpl', weapon: 'M16A2', melee: 'bayonet' },
      AR: { role: 'AR', title: 'Automatic Rifleman', rank: 'LCpl', weapon: 'M249', melee: 'knife' },
      G:  { role: 'G', title: 'Grenadier', rank: 'LCpl', weapon: 'M16A2', launcher: 'M203', melee: 'bayonet' },
      R:  { role: 'R', title: 'Rifleman', rank: 'PFC', weapon: 'M16A2', melee: 'bayonet' },
    },
    leader: 'SL', groups: [['TL', 'AR', 'G', 'R']],
  },
  usmc1983: {
    label: 'USMC rifle squad, 1983', side: 'blue', nation: 'United States', unitName: '1st Squad', men: 'Marines', year: 1983,
    unit: 'A Marine rifle squad of 1983: M16A1 rifles, an M16A1 on automatic as each team\'s automatic rifle (the M249 is not yet issued), and an M203.',
    morale: 80, training: 0.85, skill: 1, grenade: 'M67', frags: 2, names: 'usmc',
    billets: {
      SL: { role: 'SL', title: 'Squad Leader', rank: 'Sgt', weapon: 'M16A130', melee: 'bayonet' },
      TL: { role: 'TL', title: 'Fire Team Leader', rank: 'Cpl', weapon: 'M16A130', melee: 'bayonet' },
      AR: { role: 'AR', title: 'Automatic Rifleman', rank: 'LCpl', weapon: 'M16A1AR30', melee: 'bayonet' },
      G:  { role: 'G', title: 'Grenadier', rank: 'LCpl', weapon: 'M16A130', launcher: 'M203', melee: 'bayonet' },
      R:  { role: 'R', title: 'Rifleman', rank: 'PFC', weapon: 'M16A130', melee: 'bayonet' },
    },
    leader: 'SL', groups: [['TL', 'AR', 'G', 'R']],
  },
  usmc1970: {
    label: 'USMC rifle squad, 1970', side: 'blue', nation: 'United States', unitName: '1st Squad', men: 'Marines', year: 1970,
    unit: 'A Marine rifle squad in Vietnam, 1970: M16A1 rifles with 20-round magazines, an M16A1 on automatic as each team\'s automatic rifle, and an M79 grenadier with a .45 pistol.',
    morale: 78, training: 0.85, skill: 1, grenade: 'M67', frags: 3, names: 'usmc',
    billets: {
      SL: { role: 'SL', title: 'Squad Leader', rank: 'Sgt', weapon: 'M16A1', melee: 'bayonet' },
      TL: { role: 'TL', title: 'Fire Team Leader', rank: 'Cpl', weapon: 'M16A1', melee: 'bayonet' },
      AR: { role: 'AR', title: 'Automatic Rifleman', rank: 'LCpl', weapon: 'M16A1AR', melee: 'bayonet' },
      G:  { role: 'G', title: 'Grenadier (M79)', rank: 'LCpl', weapon: 'M1911', launcher: 'M79', melee: 'knife' },
      R:  { role: 'R', title: 'Rifleman', rank: 'PFC', weapon: 'M16A1', melee: 'bayonet' },
    },
    leader: 'SL', groups: [['TL', 'AR', 'G', 'R']],
  },
  usmc1918: {
    label: 'USMC rifle section, 1917-18', side: 'blue', nation: 'United States', unitName: 'Rifle section, 5th Marines', men: 'Marines', year: 1918,
    unit: 'A Marine rifle section of the 4th Brigade in France: three eight-man squads with M1903 Springfields, a Chauchat automatic rifle and two VB rifle grenadiers each. Marines are noted marksmen.',
    morale: 82, training: 0.85, skill: 1.1, grenade: 'F1FR', frags: 2, names: 'usmc', teamWord: 'Sqd', teamName: 'Squad', hqShort: 'Lt',
    billets: {
      LT:  { role: 'SL', title: 'Section Leader', rank: '2ndLt', weapon: 'M1903', melee: 'bayonet' },
      CPL: { role: 'TL', title: 'Squad Leader', rank: 'Cpl', weapon: 'M1903', melee: 'bayonet' },
      AR:  { role: 'AR', title: 'Automatic Rifleman', rank: 'Pvt', weapon: 'CHAUCHAT', melee: 'knife' },
      AAR: { role: 'R', title: 'Assistant Automatic Rifleman', rank: 'Pvt', weapon: 'M1903', melee: 'bayonet' },
      VB:  { role: 'G', title: 'Rifle Grenadier', rank: 'Pvt', weapon: 'M1903', launcher: 'VB', melee: 'bayonet' },
      R:   { role: 'R', title: 'Rifleman', rank: 'Pvt', weapon: 'M1903', melee: 'bayonet' },
    },
    leader: 'LT', groups: [['CPL', 'AR', 'AAR', 'VB', 'VB', 'R', 'R', 'R']],
  },
  continental1779: {
    label: 'Continental light infantry, 1779', side: 'blue', nation: 'United States', unitName: 'Light infantry company', men: 'Continentals', year: 1779,
    unit: 'A company of Continental light infantry, picked men from the line regiments: Charleville muskets and bayonets, no cartridges to spare. Trained under von Steuben\'s drill; they fight in line and use the bayonet.',
    morale: 74, training: 0.95, skill: 0.9, grenade: null, frags: 0, names: 'continental', teamWord: 'Sec', teamName: 'Section', hqShort: 'Capt',
    billets: {
      CAPT: { role: 'SL', title: 'Company Commander', rank: 'Capt', weapon: 'CHARLEVILLE', melee: 'sword' },
      SGT:  { role: 'TL', title: 'Sergeant', rank: 'Sgt', weapon: 'CHARLEVILLE', melee: 'bayonet' },
      CPL:  { role: 'R', title: 'Corporal', rank: 'Cpl', weapon: 'CHARLEVILLE', melee: 'bayonet' },
      PVT:  { role: 'R', title: 'Private', rank: 'Pvt', weapon: 'CHARLEVILLE', melee: 'bayonet' },
    },
    leader: 'CAPT', groups: [['SGT', 'CPL', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT']],
  },
  plymouth1675: {
    label: 'Plymouth Colony militia, 1675', side: 'blue', nation: 'Plymouth Colony', unitName: 'Militia company', men: 'militiamen', year: 1675,
    unit: 'A company of Plymouth Colony militia: farmers under their elected officers, with flintlock firelocks and some old matchlocks, swords and a sergeant\'s halberd. Brave enough, little drilled, unused to fighting in the woods.',
    morale: 68, training: 1.15, skill: 0.85, grenade: null, frags: 0, names: 'colonial', teamWord: 'Sec', teamName: 'Section', hqShort: 'Capt',
    billets: {
      CAPT: { role: 'SL', title: 'Captain', rank: 'Capt', weapon: 'FIRELOCK', melee: 'sword' },
      SGT:  { role: 'TL', title: 'Sergeant', rank: 'Sgt', weapon: 'FIRELOCK', melee: 'halberd' },
      CPL:  { role: 'R', title: 'Corporal', rank: 'Cpl', weapon: 'FIRELOCK', melee: 'sword' },
      SOL:  { role: 'R', title: 'Soldier', rank: 'Pvt', weapon: [['FIRELOCK', 7], ['MATCHLOCK', 3]], melee: 'sword' },
    },
    leader: 'CAPT', groups: [['SGT', 'CPL', 'SOL', 'SOL', 'SOL', 'SOL', 'SOL', 'SOL', 'SOL', 'SOL', 'SOL', 'SOL']],
  },
  aln1961: {
    label: 'ALN section, 1961', side: 'blue', nation: 'Algeria (FLN)', unitName: 'ALN ferka', men: 'moudjahidine', year: 1961,
    unit: 'A section (ferka) of the ALN in the Aurès-Nementcha: MAS-36 and Lee-Enfield rifles, Mausers, a captured MAT 49 for each group leader, an FM 24/29 or Bren. Hardened by seven years of war and the Challe offensives; fights from the rocks and disperses when pressed.',
    morale: 74, training: 1, skill: 0.85, grenade: 'MILLS', frags: 1, names: 'algerian', teamWord: 'Grp', teamName: 'Group', hqShort: 'Ldr',
    billets: {
      LDR:  { role: 'SL', title: 'Section Leader', rank: 'Moulazim', weapon: 'MAT49', melee: 'knife' },
      ARIF: { role: 'TL', title: 'Group Leader', rank: 'Arif', weapon: 'MAT49', melee: 'knife' },
      FM:   { role: 'AR', title: 'Machine Gunner', rank: 'Djoundi', weapon: [['FM2429', 1], ['BREN', 1]], melee: 'knife' },
      DJ:   { role: 'R', title: 'Moudjahid', rank: 'Djoundi', weapon: [['MAS36', 4], ['ENFIELD', 3], ['K98K', 2], ['MAT49', 1]], melee: 'knife' },
    },
    leader: 'LDR', groups: [['ARIF', 'FM', 'DJ', 'DJ', 'DJ', 'DJ', 'DJ', 'DJ', 'DJ', 'DJ']],
  },
  mujahideen1980: {
    label: 'Afghan mujahideen, 1980s', side: 'blue', nation: 'Afghan mujahideen', unitName: 'Mujahideen group', men: 'mujahideen', year: 1980,
    unit: 'A mujahideen group of Jamiat-e Islami: Lee-Enfield .303 rifles and captured AKMs, an RPD and an RPG-7 for each group. Fine shots at long range from the heights; they know every path.',
    morale: 76, training: 1, skill: 0.95, grenade: 'RGD5', frags: 1, names: 'afghan', teamWord: 'Grp', teamName: 'Group', hqShort: 'Cdr',
    billets: {
      CDR: { role: 'SL', title: 'Commander', rank: '', weapon: 'AKM', melee: 'knife' },
      TL:  { role: 'TL', title: 'Group Leader', rank: '', weapon: 'AKM', melee: 'knife' },
      RPG: { role: 'RPG', title: 'RPG Gunner', rank: '', weapon: 'ENFIELD', launcher: 'RPG7PG', melee: 'knife' },
      MG:  { role: 'AR', title: 'Machine Gunner', rank: '', weapon: 'RPD', melee: 'knife' },
      R:   { role: 'R', title: 'Mujahid', rank: '', weapon: [['ENFIELD', 6], ['AKM', 2]], melee: 'knife' },
    },
    leader: 'CDR', groups: [['TL', 'RPG', 'MG', 'R', 'R', 'R', 'R', 'R']],
  },

  // ------------------------------------------------------------ enemies
  wampanoag1675: {
    label: 'Wampanoag war party', nation: 'Wampanoag', men: 'Wampanoag warriors', year: 1675, doctrine: 'woodland',
    unit: 'Wampanoag warriors of Metacom (King Philip), with Pocasset and Sakonnet men. Most carry flintlock trade guns and shoot well; some still use the bow. War clubs and hatchets for close work. They fight from cover in loose order, work round the flanks and avoid a stand-up fight; they close with the club when the enemy wavers.',
    morale: [62, 80], training: 0.9, skill: 1.1, grenade: null, frags: [0, 0],
    billets: {
      LEAD: { role: 'SL', title: 'War captain', weapon: 'FUSIL', melee: 'club' },
      CAPT: { role: 'TL', title: 'War leader', weapon: 'FUSIL', melee: 'hatchet' },
      GUN:  { role: 'R', title: 'Warrior', weapon: 'FUSIL', melee: 'club' },
      BOW:  { role: 'R', title: 'Warrior (bow)', weapon: 'BOW', melee: 'hatchet' },
    },
    leader: 'LEAD', groupLead: 'CAPT', pool: [['GUN', 7], ['BOW', 3]], groupSize: [9, 14], groupWord: 'band',
  },
  foot33_1779: {
    label: '33rd Regiment of Foot', nation: 'Great Britain', men: 'British regulars', year: 1779, doctrine: 'line',
    unit: 'A company of the 33rd (1st West Riding) Regiment of Foot: redcoat regulars, veterans of Brandywine and Monmouth, with Short Land Pattern muskets and bayonets. They form a two-deep line, fire by volley at close range and close with the bayonet.',
    morale: [74, 88], training: 0.8, skill: 0.85, grenade: null, frags: [0, 0], coTitle: 'Lt Gen Earl Cornwallis',
    billets: {
      CAPT: { role: 'SL', title: 'Captain', weapon: 'BESS', melee: 'sword' },
      LT:   { role: 'TL', title: 'Lieutenant', weapon: 'BESS', melee: 'sword' },
      SGT:  { role: 'TL', title: 'Sergeant', weapon: 'BESS', melee: 'halberd' },
      CPL:  { role: 'R', title: 'Corporal', weapon: 'BESS', melee: 'bayonet' },
      PVT:  { role: 'R', title: 'Private', weapon: 'BESS', melee: 'bayonet' },
      GEN:  { role: 'CO', title: 'Lt Gen Earl Cornwallis', weapon: 'PISTOL', melee: 'sword' },
    },
    leader: 'CAPT', hq: ['LT'], groups: [['SGT', 'CPL', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT', 'PVT']],
  },
  german1917: {
    label: 'German Stoßtrupp and MG team', nation: 'German Empire', men: 'German infantry', year: 1917, doctrine: 'stoss',
    unit: 'German infantry of a Stoßtrupp (storm detachment) with an MG 08/15 team: Gewehr 98 rifles, stick grenades carried by the dozen, sharpened entrenching spades for hand-to-hand. They work forward behind the machine gun\'s fire and clear positions with grenades.',
    morale: [66, 82], training: 0.85, skill: 1, grenade: 'STICK', frags: [2, 3],
    billets: {
      LT:   { role: 'SL', title: 'Leutnant', weapon: 'P08', melee: 'spade', frags: 2 },
      UFFZ: { role: 'TL', title: 'Unteroffizier', weapon: 'GEW98', melee: 'spade', frags: 4 },
      GREN: { role: 'R', title: 'Grenadier', weapon: 'GEW98', melee: 'spade', frags: 3 },
      BOMB: { role: 'R', title: 'Grenade thrower', weapon: 'GEW98', melee: 'spade', frags: 8 },
      MGF:  { role: 'MG', title: 'MG gunner', weapon: 'MG0815', melee: 'knife', frags: 1 },
      MGS:  { role: 'R', title: 'MG crewman', weapon: 'GEW98', melee: 'spade', frags: 2 },
    },
    leader: 'LT', groups: [['UFFZ', 'GREN', 'GREN', 'BOMB', 'BOMB', 'GREN', 'GREN', 'GREN'], ['MGF', 'MGS', 'MGS', 'MGS'], ['UFFZ', 'GREN', 'BOMB', 'GREN', 'BOMB', 'GREN', 'GREN', 'GREN']],
  },
  rep1961: {
    label: '1er REP', nation: 'France', men: 'légionnaires', year: 1961, doctrine: 'elite',
    unit: 'Légionnaires of the 1er Régiment Étranger de Parachutistes in camouflage smocks and green berets: MAS 49/56 rifles with rifle grenades, MAT 49s for the NCOs, FM 24/29 and AA-52 machine guns. Elite, aggressive, at the top of their form, weeks before the regiment led the generals\' putsch.',
    morale: [80, 92], training: 0.75, skill: 1.1, grenade: 'DF37', frags: [2, 2],
    billets: {
      LT:  { role: 'SL', title: 'Lieutenant', weapon: 'MAT49', melee: 'knife' },
      RAD: { role: 'R', title: 'Radio operator', weapon: 'MAT49', melee: 'knife' },
      SGT: { role: 'TL', title: 'Sergent', weapon: 'MAT49', melee: 'knife', frags: 3 },
      CPL: { role: 'TL', title: 'Caporal-chef', weapon: 'MAS4956', melee: 'bayonet' },
      FM:  { role: 'AR', title: 'Tireur FM', weapon: 'FM2429', melee: 'knife' },
      MG:  { role: 'MG', title: 'Tireur AA-52', weapon: 'AA52', melee: 'knife' },
      GR:  { role: 'G', title: 'Grenadier-voltigeur', weapon: 'MAS4956', launcher: 'RIFGR', melee: 'bayonet' },
      LEG: { role: 'R', title: 'Légionnaire', weapon: 'MAS4956', melee: 'bayonet' },
    },
    leader: 'LT', hq: ['RAD'], groups: [['SGT', 'FM', 'LEG', 'LEG', 'GR', 'LEG', 'LEG', 'LEG'], ['SGT', 'FM', 'LEG', 'GR', 'LEG', 'LEG', 'LEG', 'LEG'], ['CPL', 'MG', 'LEG', 'LEG']],
  },
  soviet1972: {
    label: 'Soviet motor rifle platoon', nation: 'Soviet Union', men: 'Soviet motor riflemen', year: 1972, doctrine: 'soviet',
    unit: 'A Soviet motor rifle platoon dismounted from its BTR-60PBs: AKM rifles, a PKM and an RPK in each squad, RPG-7s firing PG-7V, an SVD sniper. Conscripts, drilled to attack on line behind their fire, the junior leaders tied to the plan.',
    morale: [60, 74], training: 1, skill: 0.85, grenade: 'RGD5', frags: [2, 2],
    billets: {
      PL:   { role: 'SL', title: 'Platoon leader', weapon: 'AKM', melee: 'bayonet' },
      DPL:  { role: 'TL', title: 'Deputy platoon leader', weapon: 'AKM', melee: 'bayonet' },
      SNP:  { role: 'MM', title: 'Sniper', weapon: 'SVD', melee: 'knife' },
      SQL:  { role: 'TL', title: 'Squad leader', weapon: 'AKM', melee: 'bayonet' },
      MG:   { role: 'MG', title: 'Machine gunner', weapon: 'PKM', melee: 'knife' },
      RPG:  { role: 'RPG', title: 'RPG gunner', weapon: 'AKM', launcher: 'RPG7PG', melee: 'knife' },
      ARPG: { role: 'R', title: 'Assistant RPG gunner', weapon: 'AKM', melee: 'bayonet' },
      AR:   { role: 'AR', title: 'Light machine gunner', weapon: 'RPK', melee: 'knife' },
      R:    { role: 'R', title: 'Motor rifleman', weapon: 'AKM', melee: 'bayonet' },
      CR:   { role: 'CR', title: 'Helicopter crewman', weapon: 'AKMS', melee: 'knife' },
    },
    leader: 'PL', hq: ['DPL', 'SNP'], groups: [['SQL', 'MG', 'RPG', 'ARPG', 'AR', 'R', 'R']],
  },
  navinf1978: {
    label: 'Soviet naval infantry', nation: 'Soviet Union', men: 'Soviet naval infantry', year: 1978, doctrine: 'soviet',
    unit: 'Soviet naval infantry (morskaya pekhota) of the Northern Fleet, landed from the sea: black berets and striped shirts, AKM and AKMS rifles, PKM and RPK machine guns, RPG-7s. Picked men, better trained than the motor rifles and aggressive in the assault.',
    morale: [68, 82], training: 0.9, skill: 0.9, grenade: 'RGD5', frags: [2, 3],
    billets: {
      PL:   { role: 'SL', title: 'Platoon leader', weapon: 'AKMS', melee: 'bayonet' },
      DPL:  { role: 'TL', title: 'Deputy platoon leader', weapon: 'AKMS', melee: 'bayonet' },
      SNP:  { role: 'MM', title: 'Sniper', weapon: 'SVD', melee: 'knife' },
      SQL:  { role: 'TL', title: 'Squad leader', weapon: 'AKMS', melee: 'bayonet' },
      MG:   { role: 'MG', title: 'Machine gunner', weapon: 'PKM', melee: 'knife' },
      RPG:  { role: 'RPG', title: 'RPG gunner', weapon: 'AKMS', launcher: 'RPG7PG', melee: 'knife' },
      AR:   { role: 'AR', title: 'Light machine gunner', weapon: 'RPK', melee: 'knife' },
      R:    { role: 'R', title: 'Naval infantryman', weapon: [['AKM', 2], ['AKMS', 1]], melee: 'bayonet' },
    },
    leader: 'PL', hq: ['DPL', 'SNP'], groups: [['SQL', 'MG', 'RPG', 'R', 'AR', 'R', 'R']],
  },
  vdv1980: {
    label: 'Soviet airborne (VDV) platoon', nation: 'Soviet Union', men: 'Soviet paratroopers', year: 1980, doctrine: 'elite',
    unit: 'Soviet airborne troops (VDV): striped telnyashka and blue berets, AKS-74 and RPKS-74, a PKM, RPG-16s and the new GP-25. The best of the Soviet army in Afghanistan; well led, aggressive, quick to flank and to seize the heights.',
    morale: [74, 86], training: 0.85, skill: 1, grenade: 'RGD5', frags: [2, 3],
    billets: {
      PL:  { role: 'SL', title: 'Platoon leader', weapon: 'AKS74', melee: 'bayonet' },
      SNP: { role: 'MM', title: 'Sniper', weapon: 'SVD', melee: 'knife' },
      SQL: { role: 'TL', title: 'Squad leader', weapon: 'AKS74', launcher: 'GP25', melee: 'bayonet' },
      MG:  { role: 'MG', title: 'Machine gunner', weapon: 'PKM', melee: 'knife' },
      RPG: { role: 'RPG', title: 'Grenade launcher gunner', weapon: 'AKS74', launcher: 'RPG16', melee: 'knife' },
      AR:  { role: 'AR', title: 'Light machine gunner', weapon: 'RPKS74', melee: 'knife' },
      R:   { role: 'R', title: 'Paratrooper', weapon: 'AKS74', melee: 'bayonet' },
      CR:  { role: 'CR', title: 'Helicopter crewman', weapon: 'AKS74U', melee: 'knife' },
    },
    leader: 'PL', hq: ['SNP'], groups: [['SQL', 'MG', 'RPG', 'AR', 'R', 'R', 'R']],
  },
  soviet1983: {
    label: 'Soviet motor rifle platoon', nation: 'Soviet Union', men: 'Soviet motor riflemen', year: 1983, doctrine: 'soviet',
    unit: 'A Soviet motor rifle platoon dismounted from its BMP-2s: AK-74 rifles with GP-25 grenade launchers, a PKM and an RPK-74 in each squad, RPG-7s, an SVD sniper. Conscripts, drilled to attack on line with fire on the move; the junior leaders seldom depart from the plan.',
    morale: [60, 74], training: 1, skill: 0.85, grenade: 'RGD5', frags: [2, 2],
    billets: {
      PL:   { role: 'SL', title: 'Platoon leader', weapon: 'AK74', melee: 'bayonet' },
      DPL:  { role: 'TL', title: 'Deputy platoon leader', weapon: 'AK74', melee: 'bayonet' },
      SNP:  { role: 'MM', title: 'Sniper', weapon: 'SVD', melee: 'knife' },
      SQL:  { role: 'TL', title: 'Squad leader', weapon: 'AK74', melee: 'bayonet' },
      MG:   { role: 'MG', title: 'Machine gunner', weapon: 'PKM', melee: 'knife' },
      RPG:  { role: 'RPG', title: 'RPG gunner', weapon: 'AK74', launcher: 'RPG7PG', melee: 'knife' },
      ARPG: { role: 'R', title: 'Assistant RPG gunner', weapon: 'AK74', melee: 'bayonet' },
      AR:   { role: 'AR', title: 'Light machine gunner', weapon: 'RPK74', melee: 'knife' },
      G:    { role: 'G', title: 'Grenadier', weapon: 'AK74', launcher: 'GP25', melee: 'bayonet' },
      R:    { role: 'R', title: 'Motor rifleman', weapon: 'AK74', melee: 'bayonet' },
    },
    leader: 'PL', hq: ['DPL', 'SNP'], groups: [['SQL', 'MG', 'RPG', 'ARPG', 'AR', 'G', 'R']],
  },
  spetsnaz1987: {
    label: 'Soviet spetsnaz group', nation: 'Soviet Union', men: 'Soviet spetsnaz', year: 1987, doctrine: 'spetsnaz',
    unit: 'A Soviet special purpose (spetsnaz) group of the 186th Separate Detachment, out to ambush caravans: AKS-74s with GP-25s, silenced AKMS, a PKM, an SVD. Hard, experienced men who strike from ambush and are gone before help comes.',
    morale: [80, 92], training: 0.78, skill: 1.1, grenade: 'F1', frags: [3, 4],
    billets: {
      CDR: { role: 'SL', title: 'Group commander', weapon: 'AKS74', launcher: 'GP25', melee: 'knife' },
      SQL: { role: 'TL', title: 'Senior scout', weapon: 'AKS74', melee: 'knife' },
      SIL: { role: 'R', title: 'Scout (silenced rifle)', weapon: 'AKMPBS', melee: 'knife' },
      MG:  { role: 'MG', title: 'Machine gunner', weapon: 'PKM', melee: 'knife' },
      G:   { role: 'G', title: 'Scout-grenadier', weapon: 'AKS74', launcher: 'GP25', melee: 'knife' },
      R:   { role: 'R', title: 'Scout', weapon: 'AKS74', melee: 'knife' },
      MM:  { role: 'MM', title: 'Sniper', weapon: 'SVD', melee: 'knife' },
    },
    leader: 'CDR', groups: [['SQL', 'SIL', 'MG', 'G', 'R', 'MM'], ['SQL', 'R', 'G', 'SIL', 'R']],
  },
  nva1970: {
    label: 'North Vietnamese Army platoon', nation: 'North Vietnam', men: 'NVA soldiers', year: 1970, doctrine: 'nva',
    unit: 'A North Vietnamese Army (PAVN) infantry platoon in pith helmets and khaki: AK-47 (Type 56) rifles and SKS carbines, RPD machine guns, B41 rocket launchers, stick grenades. Disciplined and well camouflaged; they hug close to stay inside your supporting fires, and pull back when it costs too much.',
    morale: [70, 84], training: 0.85, skill: 0.95, grenade: 'CHICOM', frags: [2, 3],
    billets: {
      PL:  { role: 'SL', title: 'Platoon leader', weapon: 'AK47', melee: 'bayonet' },
      POL: { role: 'TL', title: 'Political officer', weapon: 'AK47', melee: 'bayonet' },
      SQL: { role: 'TL', title: 'Squad leader', weapon: 'AK47', melee: 'bayonet' },
      AR:  { role: 'AR', title: 'RPD gunner', weapon: 'RPD', melee: 'knife' },
      B41: { role: 'RPG', title: 'B41 gunner', weapon: 'AK47', launcher: 'B41', melee: 'knife' },
      R:   { role: 'R', title: 'Soldier', weapon: 'AK47', melee: 'bayonet' },
      SKS: { role: 'R', title: 'Soldier', weapon: 'SKS', melee: 'bayonet' },
    },
    leader: 'PL', hq: ['POL'], groups: [['SQL', 'AR', 'B41', 'R', 'R', 'SKS', 'R', 'SKS', 'R']],
  },
  vc1970: {
    label: 'Viet Cong local force', nation: 'Viet Cong (NLF)', men: 'Viet Cong guerrillas', year: 1970, doctrine: 'guerrilla',
    unit: 'Viet Cong local-force guerrillas in black pajamas: SKS carbines, captured M1 carbines and Garands, a few AK-47s, an RPD, a B40, homemade grenades. They live among the hamlets in three-man cells, fight from bunkers and tree lines, hold fire until close and slip away.',
    morale: [52, 70], training: 1, skill: 0.85, grenade: 'CHICOM', frags: [1, 2],
    billets: {
      LEAD: { role: 'SL', title: 'Squad leader', weapon: 'AK47', melee: 'knife' },
      CELL: { role: 'TL', title: 'Cell leader', weapon: 'SKS', melee: 'knife' },
      SKS:  { role: 'R', title: 'Guerrilla', weapon: 'SKS', melee: 'knife' },
      CARB: { role: 'R', title: 'Guerrilla', weapon: 'CARBINE', melee: 'knife' },
      GAR:  { role: 'R', title: 'Guerrilla', weapon: 'GARAND', melee: 'knife' },
      MAT:  { role: 'R', title: 'Guerrilla', weapon: 'MAT49', melee: 'knife' },
      AK:   { role: 'R', title: 'Guerrilla', weapon: 'AK47', melee: 'knife' },
      B40:  { role: 'RPG', title: 'B40 gunner', weapon: 'SKS', launcher: 'B40', melee: 'knife' },
      RPD:  { role: 'AR', title: 'RPD gunner', weapon: 'RPD', melee: 'knife' },
    },
    leader: 'LEAD', groupLead: 'CELL', pool: [['SKS', 4], ['CARB', 2], ['GAR', 1], ['MAT', 1], ['AK', 2], ['B40', 1], ['RPD', 0.7]], groupSize: [3, 4], groupWord: 'cell',
  },
  haiti1994: {
    label: 'Armed attachés and FRAPH', nation: 'Haitian paramilitaries', men: 'armed attachés', year: 1994, doctrine: 'gang',
    unit: 'Armed attachés and FRAPH gangs of Les Cayes, with former FAd\'H soldiers among them: old M1 Garands and M1 carbines, Uzis, pump shotguns, .38 revolvers, Ruger .22 rifles, machetes. Undisciplined, poor shots, quick to scatter once they take casualties.',
    morale: [24, 44], training: 1.5, skill: 0.55, grenade: null, frags: [0, 0],
    billets: {
      BOSS: { role: 'SL', title: 'Gang boss', weapon: 'UZI', melee: 'machete' },
      LT:   { role: 'TL', title: 'Gang lieutenant', weapon: 'GARAND', melee: 'machete' },
      GAR:  { role: 'R', title: 'Attaché', weapon: 'GARAND', melee: 'machete' },
      CARB: { role: 'R', title: 'Attaché', weapon: 'CARBINE', melee: 'machete' },
      SHOT: { role: 'R', title: 'Attaché', weapon: 'SHOTGUN', melee: 'machete' },
      REV:  { role: 'R', title: 'Attaché', weapon: 'REVOLVER', melee: 'machete' },
      R22:  { role: 'R', title: 'Attaché', weapon: 'RUGER1022', melee: 'machete' },
      UZI:  { role: 'R', title: 'Attaché', weapon: 'UZI', melee: 'machete' },
    },
    leader: 'BOSS', groupLead: 'LT', pool: [['GAR', 3], ['CARB', 3], ['SHOT', 2], ['REV', 2], ['R22', 2], ['UZI', 1]], groupSize: [4, 6], groupWord: 'gang',
  },
  prc2027: {
    label: 'PLA Navy Marine squad', nation: "People's Republic of China", men: 'PLA marines', year: 2027, doctrine: 'modern',
    unit: 'A PLA Navy Marine Corps rifle squad garrisoning the island: QBZ-191 rifles, a QLG-10 grenade launcher, a QJS-161 light machine gun, a QBU-191 marksman rifle and PF-89 rockets. Well equipped and fit; untested in battle.',
    morale: [60, 76], training: 0.95, skill: 0.95, grenade: 'T82', frags: [2, 2],
    billets: {
      SL:  { role: 'SL', title: 'Squad leader', weapon: 'QBZ191', melee: 'bayonet' },
      DSL: { role: 'TL', title: 'Deputy squad leader', weapon: 'QBZ191', melee: 'bayonet' },
      TL:  { role: 'TL', title: 'Team leader', weapon: 'QBZ191', melee: 'bayonet' },
      AR:  { role: 'AR', title: 'Light machine gunner', weapon: 'QJS161', melee: 'knife' },
      G:   { role: 'G', title: 'Grenadier', weapon: 'QBZ191', launcher: 'QLG10', melee: 'bayonet' },
      PF:  { role: 'RPG', title: 'Rocket gunner', weapon: 'QBZ191', launcher: 'PF89', melee: 'bayonet' },
      MM:  { role: 'MM', title: 'Marksman', weapon: 'QBU191', melee: 'knife' },
      R:   { role: 'R', title: 'Rifleman', weapon: 'QBZ191', melee: 'bayonet' },
    },
    leader: 'SL', groups: [['DSL', 'AR', 'G', 'R', 'PF'], ['TL', 'MM', 'R', 'AR', 'R']],
  },
  russia2023: {
    label: 'Russian motor rifle squad', nation: 'Russia', men: 'Russian soldiers', year: 2023, doctrine: 'modern',
    unit: 'A Russian motor rifle squad holding a tree line: AK-74M and AK-12 rifles, RPK-74 and PKP machine guns, GP-25 grenade launchers, RPG-7V2 with fragmentation rounds, an SVD. Mixed quality, veterans beside mobilized men; they dig in well and hold a position until it costs them.',
    morale: [40, 66], training: 1.05, skill: 0.85, grenade: 'RGD5', frags: [2, 3],
    billets: {
      SL:  { role: 'SL', title: 'Squad leader', weapon: 'AK12', melee: 'bayonet' },
      TL:  { role: 'TL', title: 'Senior soldier', weapon: 'AK74M', melee: 'bayonet' },
      AR:  { role: 'AR', title: 'Machine gunner', weapon: [['RPK74', 2], ['RPK16', 1]], melee: 'knife' },
      MG:  { role: 'MG', title: 'PKP gunner', weapon: 'PKP', melee: 'knife' },
      G:   { role: 'G', title: 'Grenadier', weapon: 'AK74M', launcher: 'GP25', melee: 'bayonet' },
      RPG: { role: 'RPG', title: 'RPG gunner', weapon: 'AK74M', launcher: 'RPG7', melee: 'knife' },
      MM:  { role: 'MM', title: 'Sniper', weapon: [['SVD', 2], ['SVDM', 1]], melee: 'knife' },
      R:   { role: 'R', title: 'Rifleman', weapon: [['AK74M', 3], ['AK12', 1]], melee: 'bayonet' },
    },
    leader: 'SL', groups: [['TL', 'AR', 'G', 'R', 'RPG', 'MG'], ['TL', 'MM', 'R', 'R', 'R']],
  },
};

// ---------------------------------------------------------------- scenarios
// A scenario: the enemy force and its strength, the era's own friendly force, the ground,
// the missions that fit, a place name for the objective, and the history behind it. status
// says how much of it happened.
const SCENARIOS = {
  modern: {
    label: 'Present day · Generic OPFOR', status: null, opfor: null, blue: 'usmc', region: null, missions: null,
  },
  swansea1675: {
    label: '1675 · Wampanoag war party, Swansea', status: 'Historical', date: '24 June 1675', place: 'Swansea, Plymouth Colony', war: "King Philip's War",
    opfor: 'wampanoag1675', size: [180, 220], blue: 'plymouth1675', region: 'newengland', missions: ['townAttack', 'meeting', 'column'], siteName: 'Swansea',
    history: 'On 20 June 1675 Wampanoag warriors of Metacom (King Philip) began looting abandoned houses at Swansea; on 24 June they killed settlers there, the opening blows of King Philip\'s War. About two hundred warriors are reported on the move.',
  },
  cornwallis1779: {
    label: '1779 · 33rd Foot with Cornwallis, outside New York', status: 'Historical fiction', date: 'October 1779', place: 'Westchester County, north of New York City', war: 'American Revolutionary War',
    opfor: 'foot33_1779', size: [44, 52], blue: 'continental1779', region: 'hudson', missions: ['meeting', 'column', 'attack', 'village'], hvt: 'GEN',
    history: 'In 1779 the British held New York City and the ground north of it to Kingsbridge. Lt Gen Charles, Earl Cornwallis, colonel of the 33rd Foot since 1766, was with the army there until he sailed for Charleston in December. Here a company of his regiment is out beyond the lines with Cornwallis himself riding with it: an invention, but one the units and the ground allow.',
  },
  bathelemont1917: {
    label: '1917 · German trench raid, Lorraine', status: 'Historical setting', date: '3 November 1917', place: 'Bathelémont, Lorraine', war: 'First World War',
    opfor: 'german1917', size: [20, 26], blue: 'usmc1918', region: 'lorraine', missions: ['meeting'],
    history: 'Before dawn on 3 November 1917 a German raiding party struck the trenches of the U.S. 16th Infantry at Bathelémont and killed the first three American soldiers of the war. Here it is a Marine section that stands in the way.',
  },
  mgnest1917: {
    label: '1917 · German machine gun nest, Lorraine', status: 'Historical fiction', date: 'December 1917', place: 'Lunéville sector, Lorraine', war: 'First World War',
    opfor: 'german1917', size: [18, 24], blue: 'usmc1918', region: 'lorraine', missions: ['hillStrongpoint', 'village', 'treeLine'],
    groups: [['MGF', 'MGS', 'MGS', 'MGS'], ['UFFZ', 'GREN', 'GREN', 'BOMB', 'GREN', 'GREN'], ['MGF', 'MGS', 'MGS', 'MGS'], ['UFFZ', 'GREN', 'BOMB', 'GREN', 'GREN']],
    history: 'German machine gun teams held the woods and villages of the quiet Lorraine sector, where the first American units learned the trade. A Marine section is sent to clear one of their posts.',
  },
  rep1961: {
    label: '1961 · 1er REP sweep, Algerian djebel', status: 'Historical setting', date: 'early April 1961', place: 'Nementcha mountains, eastern Algeria', war: 'Algerian War',
    opfor: 'rep1961', size: [56, 64], blue: 'aln1961', region: 'algeria', missions: ['meeting', 'crossingFront', 'camp', 'hillStrongpoint'],
    history: 'In the spring of 1961 the 1er REP was hunting ALN bands in the Aurès-Nementcha. On 21 April its officers took the regiment into Algiers in the generals\' putsch; it was disbanded that June. Here, weeks before, the légionnaires sweep through the djebel.',
  },
  fulda1972: {
    label: '1972 · Soviet motor rifles in the Fulda Gap', status: 'Alternate history', date: 'August 1972', place: 'near Hünfeld, Hesse, West Germany', war: 'Third World War (fictional)',
    opfor: 'soviet1972', size: [22, 26], blue: 'usmc1970', region: 'hesse', missions: ['meeting', 'village', 'bridge', 'treeLine', 'hillStrongpoint', 'column'],
    history: 'There was no Soviet attack into West Germany. In this timeline the Cold War turns hot in the summer of 1972, and a Marine squad, flown in to reinforce the Central Front, meets a Soviet motor rifle platoon in the hills of Hesse.',
  },
  finnmark1978: {
    label: '1978 · Soviet naval infantry, northern Norway', status: 'Alternate history', date: 'March 1978', place: 'Porsanger, Finnmark, Norway', war: 'Third World War (fictional)',
    opfor: 'navinf1978', size: [20, 26], blue: 'usmc1983', region: 'norway', missions: ['meeting', 'village', 'bridge', 'relay', 'hillStrongpoint'],
    history: 'NATO planned to reinforce northern Norway with Marines, and the Soviet Northern Fleet\'s naval infantry trained to land there. In this timeline they do.',
  },
  panjshir1980: {
    label: '1980 · Soviet airborne in the Panjshir', status: 'Historical setting', date: 'April 1980', place: 'Panjshir valley, Afghanistan', war: 'Soviet-Afghan War',
    opfor: 'vdv1980', size: [20, 25], blue: 'mujahideen1980', region: 'panjshir', missions: ['village', 'meeting', 'hillStrongpoint', 'helo', 'withdrawal'],
    history: 'In April 1980 Soviet airborne and motor rifle troops pushed up the Panjshir valley against Ahmad Shah Massoud\'s mujahideen, the first of nine Soviet offensives there.',
  },
  ablearcher1983: {
    label: '1983 · Soviet motor rifles, Able Archer goes hot', status: 'Alternate history', date: 'November 1983', place: 'near Rasdorf, Hesse, West Germany', war: 'Third World War (fictional)',
    opfor: 'soviet1983', size: [22, 26], blue: 'usmc1983', region: 'hesse', missions: ['meeting', 'village', 'bridge', 'treeLine', 'hillStrongpoint', 'commandPost', 'column'],
    history: 'In November 1983 NATO\'s Able Archer exercise alarmed the Soviet leadership; it went no further. Here it does, and a Soviet motor rifle platoon (Sukhoputnyye Voyska) comes over the hills toward a Marine squad.',
  },
  shahjoy1987: {
    label: '1987 · Spetsnaz ambush group, Zabul', status: 'Historical setting', date: 'summer 1987', place: 'Shahjoy district, Zabul, Afghanistan', war: 'Soviet-Afghan War',
    opfor: 'spetsnaz1987', size: [12, 16], blue: 'mujahideen1980', region: 'kandahar', missions: ['ambush', 'observationPost', 'withdrawal', 'reconTown'],
    history: 'From 1985 the Soviet 186th Separate Spetsnaz Detachment, based at Shahjoy, ambushed mujahideen supply caravans on the roads and tracks out of Pakistan.',
  },
  quesonnva1970: {
    label: '1970 · NVA platoon, Que Son', status: 'Historical setting', date: 'May 1970', place: 'Que Son, Quang Nam province, South Vietnam', war: 'Vietnam War',
    opfor: 'nva1970', size: [26, 34], blue: 'usmc1970', region: 'jungle', missions: ['ambush', 'meeting', 'camp', 'depot', 'treeLine', 'village', 'column'],
    history: 'In 1970 the 1st Marine Division fought NVA regiments in the Que Son valley and the "Arizona Territory" of Quang Nam province.',
  },
  quangnamvc1970: {
    label: '1970 · Viet Cong guerrillas, Quang Nam', status: 'Historical setting', date: 'August 1970', place: 'Dien Ban, Quang Nam province, South Vietnam', war: 'Vietnam War',
    opfor: 'vc1970', size: [10, 18], blue: 'usmc1970', region: 'jungle', missions: ['farmRest', 'village', 'ambush', 'foragers', 'checkpoint', 'depot', 'stragglers'],
    history: 'Marine squads of the Combined Action Program and the line battalions hunted Viet Cong local forces through the hamlets and paddies around Da Nang.',
  },
  lescayes1994: {
    label: '1994 · Armed attachés, Les Cayes', status: 'Historical fiction', date: 'September 1994', place: 'Les Cayes, Haiti', war: 'Operation Uphold Democracy',
    opfor: 'haiti1994', size: [12, 20], blue: 'usmc1994', region: 'haiti', missions: ['checkpoint', 'townAttack', 'village', 'truck', 'stragglers', 'farmRest'],
    history: 'In September 1994 U.S. forces landed in Haiti. On 24 September a Marine patrol at Cap-Haïtien killed ten Haitian soldiers in a firefight. Here a Marine squad goes after the armed attachés of Les Cayes.',
  },
  spratly2027: {
    label: '2027 · PLA marines on a Spratly island', status: 'Alternate history', date: '2027', place: 'Spratly Islands, South China Sea', war: 'Pacific war (fictional)',
    opfor: 'prc2027', size: [10, 12], blue: 'usmc', region: 'island', missions: ['village', 'hillStrongpoint', 'observationPost', 'relay', 'depot', 'treeLine'], sep: [450, 800],
    history: 'No war has come to the Spratlys. In this one a Marine squad, landed by night, must take a Chinese-held island.',
  },
  robotyne2023: {
    label: '2023 · Russian squad in a tree line, Zaporizhzhia', status: 'Historical setting', date: 'summer 2023', place: 'Robotyne, Zaporizhzhia oblast, Ukraine', war: 'Russo-Ukrainian War',
    opfor: 'russia2023', size: [10, 16], blue: 'usmc', region: 'ukraine', missions: ['treeLine', 'village', 'hillStrongpoint', 'observationPost', 'depot', 'meeting'],
    history: 'In the summer of 2023 Ukraine\'s counteroffensive fought through the Russian tree lines and minefields south of Orikhiv. The enemy and the ground are as they were; the Marine squad is not.',
  },
};
const SCENARIO_KEYS = Object.keys(SCENARIOS);
// The forces the player can command: today's Marines and each era's own.
const FRIENDLY_KEYS = ['usmc', 'usmc1994', 'usmc1983', 'usmc1970', 'usmc1918', 'continental1779', 'plymouth1675', 'aln1961', 'mujahideen1980'];
function friendlyLabel(k) { return k === 'usmc' ? 'USMC rifle squad, today' : FORCES[k].label; }

// What the order and the battle box say of a force: its men, its description, its nation.
function forceInfo(kind) {
  if (FORCES[kind]) return FORCES[kind];
  if (kind === 'usmc') return { men: 'Marines', nation: 'United States', unitName: '1st Squad', unit: 'A Marine rifle squad: three fire teams.' };
  return Object.assign({ nation: 'Opposing force', doctrine: 'modern' }, OPFOR_KINDS[kind] || OPFOR_KINDS.regular);
}

function pickWeighted(w) {
  if (typeof w === 'string') return w;
  const tot = w.reduce((n, x) => n + x[1], 0);
  let r = rand() * tot;
  for (const [k, n] of w) if ((r -= n) <= 0) return k;
  return w[0][0];
}

// Build a force. The player's side has its three teams; the enemy n men in groups, from the
// templates in turn (the last one cut short), or bands drawn from the pool.
function buildForce(key, side, n, opts) {
  const F = FORCES[key], o = opts || {};
  const morale = Array.isArray(F.morale) ? randRange(F.morale[0], F.morale[1]) : F.morale;
  const sq = new Squad(side, side === 'blue' ? F.unitName : 'Enemy ' + (n <= 15 ? 'squad' : n <= 40 ? 'platoon' : 'company'), morale);
  sq.training = F.training; sq.skill = F.skill; sq.kind = key; sq.force = F;
  if (F.teamWord) { sq.teamWord = F.teamWord; sq.teamName = F.teamName; }
  if (F.hqShort) sq.hqShort = F.hqShort;
  const names = side === 'blue' ? shuffle((ERA_NAMES[F.names] || SURNAMES).slice()) : null;
  const fr = Array.isArray(F.frags) ? F.frags : [F.frags || 0, F.frags || 0];
  const make = (bk, team) => {
    const b = F.billets[bk], wk = pickWeighted(b.weapon);
    const s = new Soldier(side, b.role, team, {
      title: b.title, rank: side === 'blue' ? b.rank : '', name: side === 'blue' ? (names.pop() || 'Smith') : b.title,
      weapon: wk, launcher: b.launcher || null, melee: b.melee, grenade: F.grenade || 'M67',
      frags: F.grenade ? (b.frags != null ? b.frags : randInt(fr[0], fr[1])) : 0, skill: F.skill,
    });
    s.billetKey = bk;
    team.members.push(s);
    return s;
  };
  sq.hq = new Team(side, sq, 0, side === 'blue' ? (F.billets[F.leader].title) : 'Enemy leader');
  sq.leader = make(o.leader || F.leader, sq.hq);
  for (const h of F.hq || []) make(h, sq.hq);
  const groups = o.groups || F.groups;
  if (side === 'blue') {
    for (let k = 1; k <= 3; k++) {
      const t = new Team(side, sq, k, ORDINAL[k - 1] + ' ' + (F.teamName || 'Fire Team'));
      for (const bk of groups[(k - 1) % groups.length]) make(bk, t);
      sq.teams.push(t);
    }
    return sq;
  }
  let left = n - sq.hq.members.length, k = 0;
  while (left > 0) {
    let tpl;
    if (groups) tpl = groups[k % groups.length].slice();
    else { const size = randInt(F.groupSize[0], F.groupSize[1]); tpl = [F.groupLead]; while (tpl.length < size) tpl.push(pickWeighted(F.pool)); }
    // Too few left for a group of their own: they join the last one.
    if (left < 3 && sq.teams.length) { for (const bk of tpl.slice(1, 1 + left)) make(bk, sq.teams[sq.teams.length - 1]); break; }
    const t = new Team(side, sq, ++k, 'Enemy ' + (F.groupWord || 'group') + ' ' + k);
    for (const bk of tpl.slice(0, left)) make(bk, t);
    left -= t.members.length;
    sq.teams.push(t);
  }
  return sq;
}

// The player's force for a new mission: today's Marines with the chosen loadout, or another era's.
function buildBlue(set) {
  const k = set.friendly && set.friendly !== 'era' ? set.friendly : (scenarioOf(set).blue || 'usmc');
  if (k === 'usmc' || !FORCES[k]) return buildUSMCSquad(set.loadout);
  return buildForce(k, 'blue');
}
function scenarioOf(set) { return SCENARIOS[set && set.scenario] || SCENARIOS.modern; }
