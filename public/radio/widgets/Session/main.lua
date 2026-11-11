local ____exports = {}
local name = "Session"
--- Today at the field: the packs flown and the time in the air. A pack counts when a new one powers the receiver (not
-- when telemetry comes back after a dropout), the air time while it draws over 2 A. Kept in the model's global
-- variables 1 to 3 so a power cycle keeps them (mAhRe reads GV6 and GV7); a new day starts at zero.
local options = {}
local DRIVEN_AMPS = 2
--- The global variables it keeps its count in: the day, the packs, the air time in tens of seconds.
local DAY = 0
local PACKS = 1
local AIR = 2
--- A pack counts once it has powered the receiver this long (ticks of 10 ms): a bump is not a pack.
local SETTLE = 300
--- A new pack: its voltage back after none with the mAh count at 0. The model resets the count only when telemetry
-- stops while disarmed (SA), so a dropout in flight is not a new pack.
local NEW_PACK_MAH = 5
local function create(zone)
    return {
        zone = zone,
        powered = false,
        poweredSince = 0,
        lastTime = getTime()
    }
end
local function update()
end
--- Today as a day of the year, to start again each day.
local function today()
    local now = getDateTime()
    local days = {
        0,
        31,
        59,
        90,
        120,
        151,
        181,
        212,
        243,
        273,
        304,
        334
    }
    return days[now.mon] + now.day
end
local function draw(widget, width, height)
    if model.getGlobalVariable(DAY, 0) ~= today() then
        model.setGlobalVariable(
            DAY,
            0,
            today()
        )
        model.setGlobalVariable(PACKS, 0, 0)
        model.setGlobalVariable(AIR, 0, 0)
    end
    local now = getTime()
    local elapsed = math.min(
        50,
        math.max(0, now - widget.lastTime)
    )
    widget.lastTime = now
    local powered = getValue("VFAS") > 0.5
    if powered and not widget.powered then
        widget.poweredSince = getValue("mAh") < NEW_PACK_MAH and now or -1
    end
    if powered and widget.poweredSince >= 0 and now - widget.poweredSince >= SETTLE then
        model.setGlobalVariable(
            PACKS,
            0,
            model.getGlobalVariable(PACKS, 0) + 1
        )
        widget.poweredSince = -1
    end
    widget.powered = powered
    if powered and getValue("Curr") >= DRIVEN_AMPS then
        local tenths = (model.getGlobalVariable(AIR, 0) * 1000 + elapsed) / 1000
        model.setGlobalVariable(
            AIR,
            0,
            math.floor(tenths)
        )
        widget.lastTime = widget.lastTime - math.floor(tenths % 1 * 1000 % elapsed)
    end
    local packs = model.getGlobalVariable(PACKS, 0)
    local minutes = math.floor(model.getGlobalVariable(AIR, 0) * 10 / 60)
    lcd.drawText(
        6,
        2,
        "Today",
        SMLSIZE + lcd.RGB(10134445)
    )
    lcd.drawText(
        6,
        16,
        tostring(packs),
        (height >= 60 and DBLSIZE or MIDSIZE) + BOLD + lcd.RGB(15658734)
    )
    local packsWidth = lcd.sizeText(
        tostring(packs),
        (height >= 60 and DBLSIZE or MIDSIZE) + BOLD
    )
    lcd.drawText(
        10 + packsWidth,
        height >= 60 and 30 or 22,
        packs == 1 and "pack" or "packs",
        SMLSIZE + lcd.RGB(10134445)
    )
    lcd.drawText(
        width - 6,
        16,
        tostring(minutes) .. " min",
        MIDSIZE + BOLD + RIGHT + lcd.RGB(8181402)
    )
    lcd.drawText(
        width - 6,
        height >= 60 and 42 or 36,
        "in the air",
        SMLSIZE + RIGHT + lcd.RGB(10134445)
    )
end
local function refresh(widget, event)
    if nil ~= event then
        draw(widget, LCD_W, LCD_H)
    else
        draw(widget, widget.zone.w, widget.zone.h)
    end
end
____exports.refresh = refresh
____exports.name = name
____exports.create = create
____exports.update = update
____exports.options = options
return ____exports
