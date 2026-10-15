// Copies the FBX models used by the prototype out of the Unity project and
// converts their TGA textures to PNG (macOS `sips`).
// Usage: UNITY_ART=/path/to/Assets/_Project/_Art node tools/import-assets.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = process.env.UNITY_ART ?? '/Users/gr/WorldOfWarcry/Assets/_Project/_Art';
const OUT = join(ROOT, 'public/assets');
const C = 'Characters';
const B = 'Buildings';

const models = [
  // animations (shared skeleton)
  ...['Idle', 'Walk', 'SwordAttack', 'AxeAttack', 'Hit', 'Death'].map((n) => `${C}/Animations/${n}.fbx`),
  // humans
  `${C}/Humans/Knight/Models/human_knight.fbx`,
  `${C}/Humans/Knight/Models/sword_human_knight.fbx`,
  `${C}/Humans/Peasant/Models/peasant.fbx`,
  `${C}/Humans/Peasant/Models/axe.fbx`,
  `${C}/Humans/Soldier/Models/soldier.fbx`,
  `${C}/Humans/Soldier/Models/sword_soldier.fbx`,
  `${C}/Humans/Soldier/Models/shield_soldier.fbx`,
  `${C}/Humans/Paladin/Models/paladin.fbx`,
  `${C}/Humans/Paladin/Models/hammer_human_paladin.fbx`,
  `${C}/Humans/Mage/Models/mage.fbx`,
  `${C}/Humans/Mage/Models/mage_staff.fbx`,
  // orcs
  `${C}/Orcs/Grunt/Models/orc_grunt.fbx`,
  `${C}/Orcs/Grunt/Models/axe_orc_grunt.fbx`,
  `${C}/Orcs/Peon/Models/orc_peon.fbx`,
  `${C}/Orcs/Peon/Models/axe_orc_peon.fbx`,
  `${C}/Orcs/Warrior/Models/orc_warrior.fbx`,
  `${C}/Orcs/Warrior/Models/sword_orc_warrior.fbx`,
  `${C}/Orcs/Chieftain/Models/orc_chieftain.fbx`,
  `${C}/Orcs/Chieftain/Models/axe_orc_chieftain.fbx`,
  `${C}/Orcs/Shaman/Models/orc_shaman.fbx`,
  `${C}/Orcs/Shaman/Models/staff_orc_shaman.fbx`,
  // elves
  ...['Warrior/Models/elf_warrior', 'Warrior/Models/sword_elf_warrior', 'Assassin/Models/elf_assassin', 'Worker/Models/elf_worker',
    'Queen/Models/elf_queen', 'Queen/Models/glaive_elf_queen', 'Priestess/Models/elf_priestess', 'Priestess/Models/magic_ball',
  ].map((n) => `${C}/Elves/${n}.fbx`),
  // undead
  `${C}/Undead/Worker/Models/undead_worker.fbx`,
  `${C}/Undead/Warrior/Models/undead_warrior.fbx`,
  `${C}/Undead/Warrior/Models/spear_undead_warrior.fbx`,
  `${C}/Undead/Assassin/Models/undead_assassin.fbx`,
  `${C}/Undead/King/Models/undead_king.fbx`,
  `${C}/Undead/King/Models/sword_undead_king.fbx`,
  // props: humans
  ...['barrel', 'box_small_1', 'box_large_1', 'campfire', 'flag', 'lantern_street', 'anvil_big'].map(
    (n) => `${B}/Humans/Models/Parts/${n}.fbx`,
  ),
  ...['house_Lv1', 'house_Lv2', 'smithy_Lv1', 'tower_Lv1', 'barrack_Lv1', 'banner'].map(
    (n) => `${B}/Humans/Models/Buildings/${n}.fbx`,
  ),
  // props: orcs
  ...['orc_barrel', 'orc_box_small_1', 'orc_box_large_1', 'orc_campfire', 'orc_stone_big', 'orc_stone_mid',
    'orc_stone_small', 'orc_log', 'orc_wood_pile_big', 'orc_tusk_standing', 'orc_log_wall', 'orc_practice_dummy',
    'orc_skull'].map((n) => `${B}/Orcs/Models/Parts/${n}.fbx`),
  ...['orc_house_Lv1', 'orc_house_Lv2', 'orc_smithy_Lv1', 'orc_tower_Lv1', 'orc_barrack_Lv1', 'orc_banner'].map(
    (n) => `${B}/Orcs/Models/Buildings/${n}.fbx`,
  ),
  // props: undead (cemetery)
  ...['undead_tomb_stone_1', 'undead_tomb_stone_2', 'undead_tomb_stone_3', 'undead_tomb_stone_4',
    'undead_coffin', 'undead_fence', 'undead_ruins_01', 'undead_ruins_02', 'undead_obelisk', 'undead_lamp_post',
    'undead_bones_remains', 'undead_column_1', 'undead_big_bone'].map((n) => `${B}/Undead/Models/Parts/${n}.fbx`),
  // level design: walls, towers, houses, workshops
  ...['palisade_pole', 'wall_beam_large', 'wall_beam_small', 'tower_big', 'tower_human_small_1', 'human_house_large',
    'human_house_mid', 'human_house_small', 'woodcutter_building', 'wood_pile_big', 'wood_pile_small', 'practice_dummy',
    'target', 'mine_enterance', 'mine_rail_piece', 'minecart', 'saw', 'flag_pole', 'haging_lamp', 'pillar_1',
    'smithy_building', 'box_large_2', 'box_small_2', 'bucket', 'cauldron', 'shield', 'spear'].map((n) => `${B}/Humans/Models/Parts/${n}.fbx`),
  ...['wood_cutter_Lv1', 'mine_Lv1', 'oracle_Lv1', 'throne_Lv1', 'barrack_Lv2', 'tower_Lv2'].map((n) => `${B}/Humans/Models/Buildings/${n}.fbx`),
  ...['orc_pointed_beam', 'orc_beam_pile', 'orc_cabin', 'orc_high_stand', 'orc_head_lantern', 'orc_drum_big',
    'orc_stone_pillar_big', 'orc_stone_pillar_small_ringed', 'orc_stone_circle_L', 'orc_trunk_berm_L', 'orc_trunk_berm_M',
    'orc_altar', 'orc_throne', 'orc_wood_pile_small', 'orc_flag_red', 'orc_tusk', 'orc_horned_skull', 'orc_bucket',
    'orc_box_large_2', 'orc_practice_aim', 'orc_mine_enterance', 'orc_anvil'].map((n) => `${B}/Orcs/Models/Parts/${n}.fbx`),
  ...['orc_luberjack_Lv1', 'orc_mine_Lv1', 'orc_altar_Lv1', 'orc_throne_Lv1', 'orc_barrack_Lv2', 'orc_tower_Lv2'].map((n) => `${B}/Orcs/Models/Buildings/${n}.fbx`),
  ...['undead_house_tower', 'undead_tower', 'undead_tower_small', 'undead_smithy_house', 'undead_tusk_gate', 'undead_throne',
    'undead_windmill', 'undead_floating_stone', 'undead_floating_coffin', 'undead_tomb_stone_5', 'undead_tomb_stone_6',
    'undead_ground_bone_1', 'undead_ground_bone_2', 'undead_ground_bone_3', 'undead_wheel_of_pain', 'undead_lamp',
    'undead_column_2', 'undead_building', 'undead_flag', 'undead_cauldron', 'undead_wood_pile'].map((n) => `${B}/Undead/Models/Parts/${n}.fbx`),
  ...['undead_house_Lv1', 'undead_tower_Lv2', 'undead_throne_Lv1', 'undead_oracle_Lv1'].map((n) => `${B}/Undead/Models/Buildings/${n}.fbx`),
  // nature (elf kit): trees, foliage, rocks
  ...['elf_tree', 'elf_foliage_big', 'elf_foliage_mid', 'elf_foliage_small', 'elf_rock_big', 'elf_rock_small',
    'elf_tree_root_1', 'elf_tree_root_2', 'elf_tree_root_3', 'elf_trunk', 'elf_well', 'elf_log_pile', 'elf_stone_big',
    'elf_stone_small', 'elf_monolith', 'elf_totem_pole_1', 'elf_fountain'].map((n) => `${B}/Elves/Models/Parts/${n}.fbx`),
  ...['elf_mine_Lv1', 'elf_oracle_Lv1', 'elf_throne_Lv1'].map((n) => `${B}/Elves/Models/Buildings/${n}.fbx`),
];

const textures = [
  `${C}/Orcs/Shaman/Textures/orc_shaman_albedo.tga`,
  ...['Warrior/Textures/elf_warrior_tex', 'Assassin/Textures/elf_assassin_tex', 'Worker/Textures/elf_worker_tex',
    'Queen/Textures/elf_queen_tex', 'Queen/Textures/elf_queen_glow', 'Priestess/Textures/elf_priestess_tex',
    'Priestess/Textures/elf_priestess_glow'].map((n) => `${C}/Elves/${n}.tga`),
  `${B}/Elves/Textures/proto_elf_RTS_texture.tga`,
  `${C}/Humans/Knight/Textures/human_knight.tga`,
  `${C}/Humans/Peasant/Textures/human_peasant_color.tga`,
  `${C}/Humans/Peasant/Textures/proto_human_RTS_color.tga`,
  `${C}/Humans/Soldier/Textures/human_soldier_texture.tga`,
  `${C}/Humans/Paladin/Textures/human_paladin_texture.tga`,
  `${C}/Humans/Mage/Textures/human_mage_col.tga`,
  `${C}/Humans/Mage/Textures/human_mage_glow.tga`,
  `${C}/Orcs/Grunt/Textures/orc_grunt_albedo.tga`,
  `${C}/Orcs/Peon/Textures/orc_peon_albedo.tga`,
  `${C}/Orcs/Peon/Textures/proto_orc_RTS_albedo.tga`,
  `${C}/Orcs/Warrior/Textures/orc_warrior_albedo.tga`,
  `${C}/Orcs/Chieftain/Textures/orc_chieftain_albedo.tga`,
  `${C}/Undead/_Shared/Textures/undead_units_texture.tga`,
  `${C}/Undead/_Shared/Textures/undead_units_glow.tga`,
  `${B}/Humans/Textures/proto_human_RTS_color.tga`,
  `${B}/Orcs/Textures/proto_orc_RTS_color.tga`,
  `${B}/Undead/Textures/proto_undead_RTS_texture.tga`,
];

mkdirSync(join(OUT, 'models'), { recursive: true });
mkdirSync(join(OUT, 'textures'), { recursive: true });

let missing = 0;
for (const rel of models) {
  const src = join(ART, rel);
  if (!existsSync(src)) { console.warn('missing', rel); missing++; continue; }
  copyFileSync(src, join(OUT, 'models', basename(src)));
}
for (const rel of textures) {
  const src = join(ART, rel);
  if (!existsSync(src)) { console.warn('missing', rel); missing++; continue; }
  const dst = join(OUT, 'textures', basename(src).replace(/\.tga$/i, '.png'));
  execFileSync('sips', ['-s', 'format', 'png', '-Z', '1024', src, '--out', dst], { stdio: 'ignore' });
}
console.log(`models: ${models.length}, textures: ${textures.length}, missing: ${missing}`);
