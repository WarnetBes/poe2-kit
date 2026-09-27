-- oracle.lua — headless-PoB2 оракул для CI (poe2-kit).
-- Запуск (cwd = src репозитория PathOfBuilding-PoE2):
--   "..\runtime\Path of Building-PoE2.exe" ..\poe2-kit-DLS\oracle\oracle.lua
-- Механика: dofile HeadlessWrapper (штатный headless-стаб GGG-парсинга),
-- сценарии с customMods -> build.calcsTab.calcsOutput -> JSON построчно в stdout.
-- Вывод: {"name":..., "stats":{...}} — сравнивается с golden-файлом утилитой
-- compare-golden.mjs. Порядок ключей стабилен (sorted) для детерминированного diff.

dofile("HeadlessWrapper.lua")

local function jsonEsc(s)
  return tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"')
end

local function serializeSorted(tbl)
  -- tbl: плоская map number/string -> простые значения
  local keys = { }
  for k in pairs(tbl) do keys[#keys + 1] = k end
  table.sort(keys)
  local parts = { }
  for _, k in ipairs(keys) do
    local v = tbl[k]
    local vs
    if type(v) == "number" then
      vs = string.format("%.4f", v)
    elseif type(v) == "string" then
      vs = '"' .. jsonEsc(v) .. '"'
    else
      vs = tostring(v)
    end
    parts[#parts + 1] = '"' .. jsonEsc(k) .. '":' .. vs
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function round(v)
  if type(v) ~= "number" then return v end
  -- округляем до 4 знаков: числа с плавающей точкой различаются между ревизиями
  return tonumber(string.format("%.4f", v))
end

-- Снимок стата: те ключи, что важны poe2_build_estimate (EHP/ресурсы) + DPS.
local function snapshot(out)
  local keys = {
    "Life", "Mana", "EnergyShield", "Spirit",
    "LifeUnreserved", "ManaUnreserved", "EnergyShieldUnreserved",
    "Armour", "EvasionRating",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist",
    "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken",
    "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
    "TotalEHP", "PreEffectiveLifePool", "EffectiveLifePool",
    "Speed", "LifeRegen", "EnergyShieldRegen", "ManaRegen",
  }
  local snap = { }
  for _, k in ipairs(keys) do
    if out[k] ~= nil then snap[k] = round(out[k]) end
  end
  -- DPS основного скилла, если посчитан
  if out["Minions"] ~= nil then snap["Minions"] = round(out["Minions"]) end
  for k, v in pairs(out) do
    if type(k) == "string" and (k:match("^CombinedDPS") or k:match("Dps$") or k:match("^TotalDPS")) then
      snap[k] = round(v)
    end
  end
  return snap
end

-- Сценарии: детерминированные, без предметов/гемов (только customMods + json).
local scenarios = {
  { name = "novelist_default",
    mods = "" },
  { name = "resists_200",
    mods = "+200 to all resistances\n200% additional Physical Damage Reduction" },
  { name = "pool_conversions",
    mods = "Convert 100% of maximum Energy Shield to maximum Mana\n100% increased maximum Mana" },
  { name = "reduced_pools",
    mods = "5% reduced maximum life\n5% reduced maximum mana\n-2 to life\n-10% to elemental resistances\n-60% to chaos resistance\n+2 to mana" },
  { name = "big_life",
    mods = "100% increased maximum Life\n200 to maximum Life" },
}

for _, sc in ipairs(scenarios) do
  newBuild()
  build.configTab.input.enemyIsBoss = "None"
  build.configTab.input.customMods = sc.mods
  build.configTab:BuildModList()
  runCallback("OnFrame")
  local stats = snapshot(build.calcsTab.calcsOutput)
  print('{"name":"' .. jsonEsc(sc.name) .. '","stats":' .. serializeSorted(stats) .. '}')
end

os.exit(0)
