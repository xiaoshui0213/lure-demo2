// ─── Canvas (viewport) ────────────────────────────────────────
export const W = 900;
export const H = 600;

// ─── World (full sail-able sea) ───────────────────────────────
export const WORLD_W = 1800;
export const WORLD_H = 1200;

// ─── Zones (horizontal layout in world space: port | shallow | deep)
export const ZONE_PORT_W    = 240;
export const ZONE_SHALLOW_W = 720;
// Deep zone occupies the remaining width (WORLD_W - 960 = 840px)

// ─── Timing ───────────────────────────────────────────────────
export const DAY_MS   = 60_000;
export const NIGHT_MS = 60_000;

// ─── Ship ─────────────────────────────────────────────────────
export const SHIP_SPD = 200; // px/s

// ─── Resources ────────────────────────────────────────────────
export const MAX_HP      = 6;
export const MAX_SAN     = 5;
export const MAX_SUPPLY  = 5;
export const INIT_GOLD   = 20;
export const INIT_SUPPLY = 3;

// ─── Cargo ────────────────────────────────────────────────────
export const CARGO_SLOTS = 4;
export const STACK_MAX   = 3;

// ─── Economy ──────────────────────────────────────────────────
export const FISH_SELL      = 10;
export const DEEP_FISH_SELL = 18;
export const GLOW_SELL      = 25;
export const LOOT_SELL      = 30;
export const QUEST_REWARD = 25;
export const SUPPLY_PRICE = 5;
export const REPAIR_PRICE = 5;   // per HP
export const ARMOR_PRICE  = 30;
export const HOOK_PRICE   = 20;

// ─── Fishing wheel ────────────────────────────────────────────
export const WHEEL_SPEED       = 2.8;  // rad/s
export const GREEN_SECTOR_BASE = 0.55; // radians (success arc)
export const GREEN_SECTOR_HOOK = 0.75; // radians with pro hook

// ─── Fishing spots ────────────────────────────────────────────
export const FISH_SPOT_RANGE  = 55;   // ship must be within this many px
export const FISH_SPOT_STOCK  = 3;    // fish per spot
export const SHALLOW_SPOT_CNT = 3;    // daytime shallow fishing spots
export const DEEP_SPOT_CNT    = 2;    // nighttime deep fishing spots
export const SPOT_RESPAWN_MS  = 6000; // delay before a depleted spot respawns

// ─── Combat ───────────────────────────────────────────────────
export const MONSTER_HP      = 3;  // legacy fallback
export const MONSTER_SPD     = 85; // legacy fallback
export const CANNON_COOLDOWN = 1200; // ms

// ── Agile monster ─────────────────────────────────────────────
export const AGILE_HP     = 10;
export const AGILE_SPD    = 160;   // px/s — very fast
export const AGILE_DMG    = 1;
export const AGILE_HIT_CD = 3600;  // ms between damage ticks
export const AGILE_RADIUS = 13;

// ── Tank monster ──────────────────────────────────────────────
export const TANK_HP      = 20;
export const TANK_SPD     = 40;    // px/s — sluggish
export const TANK_DMG     = 1;     // 降为1，靠持续贴身施压
export const TANK_HIT_CD  = 1800;  // ms
export const TANK_RADIUS  = 34;

// ── Harpoon (player weapon) ───────────────────────────────────
export const HARPOON_COOLDOWN = 650;  // ms
export const HARPOON_SPEED    = 580;  // px/s

// Monster lurking zones
export const MONSTER_ZONE_R   = 100;   // ship trigger radius (smaller → easier to avoid)
export const MONSTER_EMERGE_MS = 800;  // emergence animation duration
export const MONSTER_LAIR_CD   = 50000; // dormant time after a kill (~50s, most of a night)

// ─── Boss ─────────────────────────────────────────────────────
export const BOSS_HP    = 18;
export const BOSS_SPD   = 55;
export const BOSS_DMG   = 2;      // boss 保留2点伤害，体现威胁
export const BOSS_REWARD_GOLD = 80;
