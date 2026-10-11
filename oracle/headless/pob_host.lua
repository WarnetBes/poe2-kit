-- pob_host.lua — line-JSON-RPC хост headless-PoB2 (эпика headless-оракул, Фаза 1).
--
-- Протокол (паттерны MIT-донора poe2-exile-architect/pob/pob_headless.lua,
-- © 2026 Max Wilk — структура фреймов/stdout-дисциплина/lua-utf8-стаб/DEFAULT_STATS):
--   stdin : {"id":<n>,"method":"<name>","params":{...}} — одна строка = один запрос
--   stdout: startup-фрейм {"ready":true,"runtimeContract":1,...}, затем по ответу на запрос;
--           EOF на stdin = корректный выход (one-shot режим MCP).
--   весь chatter движка (print/io.write) — только в stderr.
--
-- Запуск: cwd = src репозитория PathOfBuilding-PoE2:
--   luajit <poe2-kit>/oracle/headless/pob_host.lua
--   env: LUA_PATH=?.lua;?\init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua
--        LUA_CPATH=<pob2>/runtime/?.dll ; CI=true (не трогать ModCache)

package.path = "./?.lua;./?/init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua;" .. package.path

-- Pure-Lua замена C-модуля lua-utf8 (ASCII-корректна; донорский приём) — engine
-- загрузится и без собранного luautf8.
package.preload["lua-utf8"] = function()
	local u = {}
	for _, k in ipairs({ "find", "gmatch", "gsub", "match", "sub", "reverse",
		"len", "char", "byte", "upper", "lower", "rep", "format" }) do
		u[k] = string[k]
	end
	u.offset = function(s, n, i) return (i or 1) + (n or 0) end
	u.next = function(s, i)
		i = (i or 0) + 1; if i > #s then return nil end
		return i, s:byte(i)
	end
	u.charpos = function(s, i) return i or 1 end
	u.width = function() return 1 end
	return u
end

-- stdout — только JSON-фреймы; всё остальное (включая print) — stderr.
local _stdout = io.stdout
local function emit(line)
	_stdout:write(line); _stdout:write("\n"); _stdout:flush()
end
_G.print = function(...)
	local n = select("#", ...)
	local parts = {}
	for i = 1, n do parts[i] = tostring((select(i, ...))) end
	io.stderr:write(table.concat(parts, "\t")); io.stderr:write("\n")
end
io.write = function(...) io.stderr:write(...); return io.stderr end

local json = require("dkjson")
local HEADLESS_RUNTIME_CONTRACT = 1

local booted, bootErr = pcall(dofile, "HeadlessWrapper.lua")
if not booted or not build then
	emit(json.encode({ ready = false, error = "engine init failed: " .. tostring(bootErr) }))
	os.exit(1)
end

-- Каталог статов «по умолчанию» (ключи calcsTab.mainOutput — факты интерфейса PoB).
local DEFAULT_STATS = {
	"TotalDPS", "FullDPS", "CombinedDPS", "WithIgniteDPS", "AverageDamage", "Speed",
	"MovementSpeedMod", "EffectiveMovementSpeedMod", "HitChance", "CritChance", "CritMultiplier",
	"ManaCost", "Life", "LifeUnreserved", "LifeReserved", "Mana", "ManaUnreserved",
	"EnergyShield", "EnergyShieldUnreserved", "Spirit", "SpiritReserved", "SpiritUnreserved",
	"LifeRegenRecovery", "LifeLeechGainRate", "LifeOnHitRate", "EnergyShieldRegenRecovery",
	"EnergyShieldLeechGainRate", "EnergyShieldOnHitRate", "EnergyShieldRecharge",
	"ManaRegenRecovery", "NetManaRegen", "TotalEHP", "Ward", "Armour", "EvasionRating",
	"Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken",
	"ChaosMaximumHitTaken", "PhysicalMaximumHitTaken",
	"EvadeChance", "BlockChance", "SpellBlockChance", "SpellSuppressionChance",
	"MinionCombinedDPS", "MinionTotalDPS", "ActiveMinionLimit",
	"ExtraPoints", "ActiveTotemLimit", "ActiveMineLimit",
}

local asNumber = function(v)
	if type(v) == "number" then return v
	elseif type(v) == "string" then return tonumber(v) or 0
	elseif type(v) == "boolean" then return v and 1 or 0 end
	return 0
end

local function outputValue(out, key)
	out = out or {}
	local v = out[key]
	if v ~= nil then return v end
	local minion = out.Minion
	if type(minion) == "table" then
		if key == "MinionCombinedDPS" then return minion.CombinedDPS end
		if key == "MinionTotalDPS" then return minion.TotalDPS end
		if key == "ActiveMinionLimit" then return minion.ActiveMinionLimit or out.ActiveMinionLimit end
		if minion[key] ~= nil then return minion[key] end
	end
	return nil
end

local function collectStats(keys)
	local out = (build.calcsTab and build.calcsTab.mainOutput) or {}
	local res = {}
	local list = (type(keys) == "table") and keys or DEFAULT_STATS
	for _, k in ipairs(list) do
		local v = outputValue(out, k)
		local t = type(v)
		if t == "number" or t == "string" or t == "boolean" then
			res[k] = ((t == "number") and (math.floor(v * 1e6 + 0.5) / 1e6)) or v
		end
	end
	return res
end

local function recalc()
	build.buildFlag = true
	build.modFlag = true
	runCallback("OnFrame")
end

local function mainSkillName()
	local sg = build.skillsTab.socketGroupList[build.mainSocketGroup or 1]
	if sg and sg.displaySkillList then
		local s = sg.displaySkillList[sg.mainActiveSkill or 1]
		if s and s.activeEffect and s.activeEffect.grantedEffect then
			return s.activeEffect.grantedEffect.name
		end
	end
	return nil
end

-- Сводка сокет-групп (имя+уровень главной и состав) — для sanity-вывода тула.
local function skillGroupsSummary()
	local groups = {}
	for i, sg in ipairs(build.skillsTab.socketGroupList or {}) do
		local gems = {}
		for _, g in ipairs(sg.gemList or {}) do
			local nm = g.nameSpec or (g.gemData and g.gemData.grantedEffect and g.gemData.grantedEffect.name)
			if nm and nm ~= "" then gems[#gems + 1] = string.format("%s L%d", nm, asNumber(g.level)) end
		end
		if #gems > 0 then
			groups[#groups + 1] = { label = sg.label or ("Group " .. i), main = gems[1], gems = gems }
		end
	end
	return groups
end

local methods = {}

function methods.ping()
	return { pong = true }
end

function methods.new_build()
	newBuild()
	recalc()
	return { stats = collectStats() }
end

function methods.load_build_xml(p)
	assert(p and p.xml, "load_build_xml requires params.xml")
	loadBuildFromXML(p.xml, p.name or "imported")
	recalc()
	return {
		mainSkill = mainSkillName(),
		characterLevel = build.characterLevel,
		treeVersion = build.spec and build.spec.treeVersion,
		latestTreeVersion = latestTreeVersion,
		skillGroups = skillGroupsSummary(),
		stats = collectStats(p.keys),
	}
end

-- Уровень персонажа (1-100); отключает авто-уровень, чтобы значение прилипло.
function methods.set_level(p)
	local lvl = tonumber(p and p.level)
	if not lvl then return { ok = false, error = "set_level requires numeric params.level" } end
	lvl = math.max(1, math.min(100, math.floor(lvl)))
	build.characterLevelAutoMode = false
	build.characterLevel = lvl
	recalc()
	return { ok = true, level = build.characterLevel, stats = collectStats(p.keys) }
end

-- Патч build.configTab.input (what-if: боссы, charges, enemy resists, customMods...).
-- Полная замена значений по ключам; НЕ трогает неуказанные. Что-if без CAS —
-- транзакции с откатом = Фаза 2 эпики.
function methods.set_config(p)
	assert(type(p) == "table" and type(p.input) == "table", "set_config requires params.input")
	for k, v in pairs(p.input) do
		build.configTab.input[k] = v
	end
	build.configTab:BuildModList()
	recalc()
	return { applied = p.input, stats = collectStats(p.keys) }
end

function methods.stats(p)
	return { mainSkill = mainSkillName(), stats = collectStats(p and p.keys) }
end

function methods.list_methods()
	local names = {}
	for k in pairs(methods) do names[#names + 1] = k end
	table.sort(names)
	return { methods = names, defaultStats = DEFAULT_STATS }
end

-- ---------------------------------------------------------------------------
-- RPC-цикл
-- ---------------------------------------------------------------------------
emit(json.encode({
	ready = true,
	runtimeContract = HEADLESS_RUNTIME_CONTRACT,
	jit = jit and jit.version,
	pobVersion = build and build.spec and build.spec.treeVersion,
}))

for line in io.lines() do
	line = line:gsub("[\r\n]+$", "")
	if #line > 0 then
		local req = json.decode(line)
		local id = req and req.id
		local fn = req and methods[req.method]
		if not req then
			emit(json.encode({ ok = false, error = "malformed request" }))
		elseif not fn then
			emit(json.encode({ id = id, ok = false, error = "unknown method: " .. tostring(req.method) }))
		else
			local ok, result = pcall(fn, req.params or {})
			if ok then
				emit(json.encode({ id = id, ok = true, result = result }))
			else
				emit(json.encode({ id = id, ok = false, error = tostring(result) }))
			end
		end
	end
end
