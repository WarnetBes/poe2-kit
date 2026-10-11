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
-- Contract 3: +whatif — батч what-if сценариев в одном движке (Фаза 3): каждый
-- сценарий поверх baseline с CAS-откатом (конфиг через снимок before, уровень
-- через прежний characterLevel/characterLevelAutoMode); невалидный enum в одном
-- сценарии НЕ применяется и НЕ рушит остальные.
local HEADLESS_RUNTIME_CONTRACT = 3

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

-- ---------------------------------------------------------------------------
-- Фаза 2: CAS-конфиг + валидация + босс-резисты
-- ---------------------------------------------------------------------------

-- Ключи резистов врага, привязанные к enemyIsBoss. Значения = константы
-- апстрима ConfigOptions.lua (apply enemyIsBoss: Boss=30 стр.2011, Pinnacle=50
-- стр.2053, Uber=50 стр.2094; None очищает). PoB в headless ставит их только
-- как GUI-плейсхолдеры (SetPlaceholder), в расчёт резист идёт лишь из input —
-- поэтому применяем сами (паттерн MIT-донора pob_headless.lua:2688/2714).
local BOSS_ELE_RES = { Boss = 30, Pinnacle = 50, Uber = 50, None = 0 }
local BOSS_RESIST_KEYS = { "enemyFireResist", "enemyColdResist", "enemyLightningResist", "enemyChaosResist" }

-- Enum-схема конфига прямо из движка: Modules/ConfigOptions (LoadModule
-- глобален в HeadlessWrapper, стр.124). Лениво, один раз.
local configSchemaCache
local function configSchema()
	if configSchemaCache ~= nil then return configSchemaCache end
	local ok, varList = pcall(LoadModule, "Modules/ConfigOptions")
	local schema = { vars = {}, unknown = {} }
	if ok and type(varList) == "table" then
		for _, vd in ipairs(varList) do
			if type(vd) == "table" and vd.var ~= nil then
			local ent = { var = vd.var, type = vd.type, label = vd.label }
			if type(vd.list) == "table" then
				local vals = {}
				for _, item in ipairs(vd.list) do vals[#vals + 1] = item.val end
				ent.values = vals
				if vd.defaultIndex and vd.list[vd.defaultIndex] then
					ent.default = vd.list[vd.defaultIndex].val
				end
			end
			schema.vars[vd.var] = ent
			end
		end
	end
	configSchemaCache = schema
	return schema
end

-- Валидация по enum-спискам движка. errors = невалидные значения list-ключей —
-- set_config/restore_config с errors НЕ применяют ничего (CAS-атомарность).
-- warnings = неизвестные ключи (пишутся вслепую: varList покрывает только GUI-вары).
local function validateConfigInput(input)
	local schema = configSchema()
	local warnings, errors = {}, {}
	for k, v in pairs(input) do
		local ent = schema.vars[k]
		if ent == nil then
			warnings[#warnings + 1] = "unknown config key: " .. tostring(k) .. " (applied blindly)"
		elseif ent.values and type(v) == "string" then
			local okVal = false
			for _, allowed in ipairs(ent.values) do
				if v == allowed then okVal = true break end
			end
			if not okVal then
				errors[#errors + 1] = string.format("key %s: value %q not in engine list {%s}",
					tostring(k), v, table.concat(ent.values, ", "))
			end
		end
	end
	return warnings, errors
end

-- Снимок старых значений по списку ключей (nil фиксируется как json.null,
-- чтобы restore_config мог вернуть «ключа не было»).
local function configBefore(input)
	local cfg = build.configTab.configSets[build.configTab.activeConfigSetId].input
	local before = {}
	for k in pairs(input) do
		local v = cfg[k]
		if v == nil then before[k] = json.null else before[k] = v end
	end
	return before
end

-- Запись конфиг-ключей (nil/json.null → удалить ключ). После — BuildModList+recalc.
local function applyConfigInput(input)
	local cfg = build.configTab.configSets[build.configTab.activeConfigSetId].input
	for k, v in pairs(input) do
		if v == nil or v == json.null then cfg[k] = nil else cfg[k] = v end
	end
	build.configTab:BuildModList()
	recalc()
end

-- Эффективный input с авто-резистами тира босса (shared для set_config/whatif).
-- Возвращает (effective, appliedResists|nil).
local function expandBossResists(cfg)
	local effective = {}
	for k, v in pairs(cfg) do effective[k] = v end
	if cfg.enemyIsBoss == nil then return effective, nil end
	local tier = tostring(cfg.enemyIsBoss)
	local ele = BOSS_ELE_RES[tier] or 0
	local appliedResists = { tier = tier, eleResist = ele }
	for _, k in ipairs(BOSS_RESIST_KEYS) do
		if cfg[k] == nil then
			effective[k] = (k == "enemyChaosResist") and 0 or ele
			appliedResists[k] = effective[k]
		end
	end
	return effective, appliedResists
end

-- Патч build.configTab.input (what-if: боссы, charges, enemy resists, customMods...).
-- Полная замена значений по ключам; НЕ трогает неуказанные. Фаза 2: CAS —
-- возвращает `before` (снимок затронутых ключей) для restore_config и
-- автоматически проставляет резисты тира босса (PoB в headless их не применяет).
function methods.set_config(p)
	assert(type(p) == "table" and type(p.input) == "table", "set_config requires params.input")
	local warnings, errors = validateConfigInput(p.input)
	if #errors > 0 then
		return { ok = false, errorCode = "invalid_config_value", errors = errors, warnings = warnings }
	end
	-- Ключи, которые реально лягут в input: запрос + авто-резисты босса.
	local effective, appliedResists = expandBossResists(p.input)
	local before = configBefore(effective)
	applyConfigInput(effective)
	local res = {
		applied = effective,
		before = before,
		stats = collectStats(p.keys),
	}
	if appliedResists ~= nil then res.autoResists = appliedResists end
	if #warnings > 0 then res.warnings = warnings end
	return res
end

-- Откат CAS: вернуть значения из `before` (снимок set_config). nil → ключ удалён.
function methods.restore_config(p)
	assert(type(p) == "table" and type(p.before) == "table", "restore_config requires params.before")
	local warnings, errors = validateConfigInput(p.before)
	if #errors > 0 then
		return { ok = false, errorCode = "invalid_config_value", errors = errors, warnings = warnings }
	end
	local before = configBefore(p.before)
	applyConfigInput(p.before)
	local res = { restored = p.before, before = before, stats = collectStats(p.keys) }
	if #warnings > 0 then res.warnings = warnings end
	return res
end

-- Списки enum движка: { vars = { [key] = {type, label, values?, default?} } }.
function methods.get_config_schema()
	local schema = configSchema()
	local vars = {}
	for k, ent in pairs(schema.vars) do vars[k] = ent end
	return { vars = vars }
end

-- Полный CAS-снапшот билда (XML через SaveDB) — откат ЛЮБЫХ изменений,
-- не только конфига. Паттерн MIT-донора pob_headless.lua:2111-2133.
function methods.snapshot_build(p)
	local xmlText = build:SaveDB("code")
	assert(type(xmlText) == "string" and #xmlText > 0, "SaveDB produced empty build snapshot")
	return { xml = xmlText }
end

function methods.restore_build(p)
	assert(type(p) == "table" and type(p.xml) == "string" and #p.xml > 0, "restore_build requires params.xml")
	loadBuildFromXML(p.xml, "snapshot-restore")
	recalc()
	return { mainSkill = mainSkillName(), stats = collectStats(p and p.keys) }
end

-- Фаза 3: батч what-if сценариев в ОДНОМ живом движке (один boot = вся матрица).
-- Каждый сценарий применяется поверх baseline и откатывается CAS'ом до
-- следующего: конфиг — по снимку before (expandBossResists продуцирует полный
-- набор затронутых ключей), уровень — через прежние characterLevel/
-- characterLevelAutoMode. Сценарий с ошибкой валидации помечается ok:false и
-- не применяется; остальные сценарии и baseline не затрагиваются.
function methods.whatif(p)
	assert(type(p) == "table" and type(p.scenarios) == "table", "whatif requires params.scenarios")
	assert(#p.scenarios <= 12, "whatif supports up to 12 scenarios per call")
	local scenarioKeys = p.keys
	local levelBefore = build.characterLevel
	local autoModeBefore = build.characterLevelAutoMode
	local out = {
		baseline = collectStats(scenarioKeys),
		scenarios = {},
	}
	for i, sc in ipairs(p.scenarios) do
		local name = (type(sc) == "table" and type(sc.name) == "string" and sc.name ~= "") and sc.name
			or ("scenario " .. i)
		local entry = { name = name, index = i }
		if type(sc) ~= "table" or (sc.config == nil and sc.level == nil) then
			entry.ok = false
			entry.errorCode = "invalid_scenario"
			entry.errors = { "scenario needs config and/or level" }
		else
			local cfg = sc.config or {}
			if type(cfg) ~= "table" then
				entry.ok = false
				entry.errorCode = "invalid_scenario"
				entry.errors = { "scenario.config must be an object" }
			else
				-- Валидация enums делается по ЗАПРОШЕННОМУ cfg (без авто-резистов):
				-- авто-резисты генерирует хост, они всегда валидны.
				local warnings, errors = validateConfigInput(cfg)
				if #errors > 0 then
					entry.ok = false
					entry.errorCode = "invalid_config_value"
					entry.errors = errors
					if #warnings > 0 then entry.warnings = warnings end
				else
					local effective, appliedResists = expandBossResists(cfg)
					local before = configBefore(effective)
					if sc.level ~= nil then
						local lvl = tonumber(sc.level)
						if lvl and lvl >= 1 and lvl <= 100 then
							build.characterLevelAutoMode = false
							build.characterLevel = math.floor(lvl)
						end
					end
					applyConfigInput(effective)
					entry.ok = true
					entry.applied = effective
					entry.stats = collectStats(sc.keys or scenarioKeys)
					if appliedResists ~= nil then entry.autoResists = appliedResists end
					if #warnings > 0 then entry.warnings = warnings end
					-- CAS-откат к baseline для следующего сценария.
					applyConfigInput(before)
					build.characterLevelAutoMode = autoModeBefore
					build.characterLevel = levelBefore
					recalc()
				end
			end
		end
		out.scenarios[#out.scenarios + 1] = entry
	end
	return out
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
