'use strict';
// Map regions: the ground, vegetation, water, settlement and place names of each kind
// of country. The generator in map.js reads these settings; nothing here draws.

// Names are put together from parts typical of the region: a first part and an ending,
// or a whole name. Rivers have their own lists.
const REGIONS = {
  farmland: {
    label: 'Rolling farmland',
    brief: 'Rolling farmland, woods and villages.',
    relief: [60, 110], base: [6, 40], ci: 5, index: 5,
    fields: [[TER.OPEN, 3], [TER.PLOWED, 2.2], [TER.GRASS, 2.4], [TER.ORCHARD, 0.6], [TER.VINEYARD, 0.5]],
    hedges: 0.45, walls: 0.2, woods: 0.74, riverChance: 0.75,
    swamp: { reach: 10, low: 0.3, noise: 0.5 },
    villages: [2, 4], farms: [6, 10], farmWord: 'Farm', yardWalls: [0.3, 0.4],
    nameA: ['Bran', 'Hol', 'Mer', 'Ash', 'Kel', 'Dun', 'Fair', 'Stan', 'Wex', 'Oak', 'Mill', 'Thorn', 'Rock', 'Hal', 'Elm', 'Bram', 'Cold', 'Red'],
    nameB: ['ford', 'by', 'ton', 'wick', 'ham', 'field', 'dale', 'stead', 'bury', 'well', 'moor', 'ridge', 'cote', 'leigh'],
    rivers: ['Bran', 'Hol', 'Mer', 'Ash', 'Kel', 'Dun', 'Wex', 'Thorn', 'Red', 'Cold'].map(n => n.toUpperCase() + ' RIVER'),
  },

  socal: {
    label: 'Southern California coast',
    brief: 'Coastal hills: Pacific beach on the west, chaparral on the slopes, orchards and small towns.',
    relief: [120, 200], base: [0, 0], ci: 10, index: 5,
    coast: true,
    fields: [[TER.CHAPARRAL, 4], [TER.GRASS, 2], [TER.OPEN, 1.5], [TER.ORCHARD, 1.2], [TER.PLOWED, 0.8]],
    hedges: 0.12, walls: 0.05, woods: 0.82, riverChance: 0.15, dryStreams: true, ponds: 'dry',
    swamp: null,
    villages: [2, 3], farms: [4, 7], farmWord: 'Ranch', yardWalls: [0.25, 0.3],
    whole: ['San Onofre', 'San Clemente', 'Santa Margarita', 'Las Pulgas', 'San Luis Rey', 'San Mateo', 'Las Flores', 'Los Robles',
      'Cristianitos', 'Los Alamos', 'Los Pinos', 'Las Encinas', 'Oceanside', 'Horno', 'De Luz', 'Talega', 'Aliso', 'Fallbrook',
      'Trabuco', 'Mesa Verde', 'Laguna Seca', 'Arroyo Seco', 'Vista del Mar', 'Pendleton', 'Stuart Mesa', 'Ysidora', 'Margarita Peak'],
    rivers: ['SANTA MARGARITA RIVER', 'SAN LUIS REY RIVER', 'SAN MATEO CREEK', 'LAS FLORES CREEK'],
  },

  texas: {
    label: 'South Texas brush country',
    brief: 'Flat brush country: mesquite thickets, pasture and cotton fields, stock tanks and ranch roads.',
    relief: [18, 40], base: [10, 30], ci: 5, index: 5,
    fields: [[TER.OPEN, 3], [TER.BRUSH, 3.5], [TER.PLOWED, 2], [TER.GRASS, 1.6], [TER.ORCHARD, 0.3]],
    hedges: 0.3, walls: 0, woods: 0.8, riverChance: 0.5, riparian: 5,
    swamp: { reach: 4, low: 0.15, noise: 0.62 },
    villages: [1, 3], farms: [6, 10], farmWord: 'Ranch', yardWalls: [0, 0],
    nameA: ['Mesquite', 'Live Oak', 'Encino', 'Dry', 'Caddo', 'Comanche', 'Sandy', 'Turkey', 'Javelina', 'Cibolo', 'Black Jack', 'Prickly Pear'],
    nameB: [' Flat', ' Springs', ' Grove', ' Creek', ' Wells', ' Corners', ' Draw', ' Crossing', ' Hollow', ' Tank'],
    whole: ['Tilden', 'Encinal', 'Dilley', 'Pearsall', 'Charlotte', 'Freer', 'Benavides', 'Hebbronville', 'Concan', 'Los Fresnos',
      'Agua Dulce', 'San Diego', 'Rancho Viejo', 'Fowlerton', 'Christine', 'Whitsett', 'Campbellton'],
    rivers: ['NUECES RIVER', 'FRIO RIVER', 'ATASCOSA RIVER', 'SAN MIGUEL CREEK', 'LEONA RIVER'],
  },

  carolina: {
    label: 'North Carolina woods and swamp',
    brief: 'Low pine woods and blackwater swamp, tobacco fields and crossroads settlements.',
    relief: [20, 45], base: [3, 12], ci: 5, index: 5,
    fields: [[TER.WOODS, 3.2], [TER.PLOWED, 2], [TER.OPEN, 1.4], [TER.GRASS, 1.2]],
    hedges: 0.6, walls: 0, woods: 0.6, riverChance: 0.85, riparian: 8,
    swamp: { reach: 32, low: 0.5, noise: 0.36, slope: 0.07 },
    villages: [2, 3], farms: [5, 8], farmWord: 'Farm', yardWalls: [0, 0],
    nameA: ['Pine', 'Holly', 'Cedar', 'Gum', 'Spring', 'Rock', 'Lumber', 'Bladen', 'Long', 'Hope', 'Black', 'White Oak'],
    nameB: [' Springs', ' Grove', ' Hill', ' Mills', 'ton', 'ville', ' Crossroads', ' Bridge', ' Church', ' Landing'],
    whole: ['Vass', 'Linden', 'Wade', 'Godwin', 'Tar Heel', 'Lillington', 'Spout Springs', 'Manchester', 'Overhills'],
    rivers: ['CAPE FEAR RIVER', 'LUMBER RIVER', 'BLACK RIVER', 'LITTLE RIVER', 'NEW RIVER', 'SOUTH RIVER'],
  },

  arizona: {
    label: 'Arizona desert and mountains',
    brief: 'Sonoran desert flats under rocky mountains: creosote and saguaro, dry washes, long fields of fire.',
    relief: [380, 560], base: [70, 120], ci: 10, index: 5,
    ridged: true, floor: 0.08, base0: TER.DESERT, rock: 0.65, desertPatches: [[TER.CHAPARRAL, 0.12]],
    fields: null, hedges: 0, walls: 0, woods: 2, riverChance: 0.12, dryStreams: true, ponds: 'dry', riparian: 3,
    swamp: null,
    villages: [1, 2], farms: [2, 4], farmWord: 'Ranch', yardWalls: [0.4, 0.4],
    whole: ['Ajo', 'Sells', 'Quijotoa', 'Sasabe', 'Arivaca', 'Amado', 'Sonoita', 'Gila Bend', 'Why', 'Gu Vo', 'Santa Rita',
      'Agua Fria', 'Agua Caliente', 'Tres Alamos', 'Cerro Prieto', 'Cerro Colorado', 'Sierra Blanca', 'Ojo Caliente', 'Casa Grande',
      'Rio Seco', 'Tubac', 'Patagonia', 'Pozo Verde', 'Tinaja', 'Palo Verde', 'Charco'],
    rivers: ['SANTA CRUZ RIVER', 'SAN PEDRO RIVER', 'GILA RIVER', 'AGUA FRIA RIVER'],
  },

  montana: {
    label: 'Montana frozen mountains',
    brief: 'Snow-covered mountains: deep snow in the open, lodgepole pine on the slopes, frozen ponds and creeks.',
    relief: [300, 460], base: [130, 180], ci: 10, index: 5,
    ridged: true, floor: 0.25, base0: TER.SNOW, rock: 0.95, treeline: 0.75,
    fields: [[TER.SNOW, 5], [TER.WOODS, 0.5]],
    hedges: 0.1, walls: 0, woods: 0.78, riverChance: 0.6, ponds: 'ice', snow: true,
    swamp: null,
    villages: [1, 2], farms: [3, 5], farmWord: 'Ranch', yardWalls: [0, 0],
    nameA: ['Elk', 'Bear', 'Wolf', 'Bighorn', 'Granite', 'Cold', 'Eagle', 'Crazy', 'Lodgepole', 'Grizzly', 'Antelope', 'Silver'],
    nameB: [' Creek', ' Butte', ' Gulch', ' Basin', ' Springs', ' Flats', ' Ridge', ' Bow', ' Hollow'],
    whole: ['Wisdom', 'Jackson', 'Big Timber', 'Two Dot', 'Lima', 'Melrose', 'Wise River', 'Polaris', 'Martinsdale'],
    rivers: ['BIG HOLE RIVER', 'BITTERROOT RIVER', 'MUSSELSHELL RIVER', 'BOULDER RIVER', 'SMITH RIVER', 'RUBY RIVER'],
  },
};
const REGION_KEYS = Object.keys(REGIONS);
