local ____exports = {}
local name = "Pack"
--- The pack in the heli: which one (picked with the 6-position buttons before flying), volts a cell now and the lowest
-- since it was plugged in, % left from the mAh used against its size, and the last minute of volts a cell as a line.
local options = {}
--- The packs by 6-position button. Pick the button of the pack you plug in: its size makes the %, its name the log.
local SLOTS = {
    {name = "Gens Ace 1", mah = 700},
    {name = "Gens Ace 2", mah = 700},
    {name = "OMP 1", mah = 750},
    {name = "OMP 2", mah = 750},
    {name = "Eachine 1", mah = 500},
    {name = "Eachine 2", mah = 500}
}
local CELLS = 3
--- Volts a cell: the line to land at, the one a LiPo should never see.
local LAND = 3.5
local NEVER = 3.3
--- One sample a second, the last 60 for the line.
local SAMPLES = 60
--- A new pack: its voltage back after none with the mAh count at 0. The model resets the count only when telemetry
-- stops while disarmed (SA), so a dropout in flight is not a new pack.
local NEW_PACK_MAH = 5
local function create(zone)
    return {
        zone = zone,
        lowest = 0,
        samples = {},
        lastSample = 0,
        powered = false
    }
end
local function update()
end
--- The 6-position button pressed: 1 to 6.
local function slot()
    local value = getValue("6P")
    return math.max(
        1,
        math.min(
            6,
            math.floor((value + 1024) / 409.6 + 0.5) + 1
        )
    )
end
local function cellColor(volts)
    return volts <= NEVER and lcd.RGB(16734815) or (volts <= LAND and lcd.RGB(16756768) or lcd.RGB(8181402))
end
local function draw(widget, width, height)
    local pack = SLOTS[slot()]
    local volts = getValue("VFAS")
    local used = getValue("mAh")
    local powered = volts > 0.5
    local cell = powered and volts / CELLS or 0
    if powered and not widget.powered and getValue("mAh") < NEW_PACK_MAH then
        widget.lowest = 0
        widget.samples = {}
    end
    widget.powered = powered
    if powered then
        if widget.lowest == 0 or cell < widget.lowest then
            widget.lowest = cell
        end
        local now = getTime()
        if now - widget.lastSample >= 100 then
            widget.lastSample = now
            local ____widget_samples_0 = widget.samples
            ____widget_samples_0[#____widget_samples_0 + 1] = cell
            if #widget.samples > SAMPLES then
                table.remove(widget.samples, 1)
            end
        end
    end
    local left = math.max(
        0,
        math.min(100, 100 - used / pack.mah * 100)
    )
    local ink = lcd.RGB(15658734)
    local muted = lcd.RGB(10134445)
    lcd.drawText(
        6,
        2,
        ((pack.name .. ", ") .. tostring(pack.mah)) .. " mAh",
        SMLSIZE + muted
    )
    if not powered then
        lcd.drawText(6, 20, "No pack", MIDSIZE + muted)
        return
    end
    lcd.drawText(
        6,
        16,
        string.format("%.2f", cell) .. " V",
        MIDSIZE + BOLD + cellColor(cell)
    )
    lcd.drawText(
        width - 6,
        2,
        "low " .. string.format("%.2f", widget.lowest),
        SMLSIZE + RIGHT + cellColor(widget.lowest)
    )
    local barX = width - 92
    lcd.drawRectangle(
        barX,
        22,
        86,
        14,
        muted
    )
    lcd.drawFilledRectangle(
        barX + 2,
        24,
        math.floor(82 * left / 100),
        10,
        left < 20 and lcd.RGB(16734815) or (left < 35 and lcd.RGB(16756768) or lcd.RGB(8181402))
    )
    lcd.drawText(
        barX + 43,
        22,
        tostring(math.floor(left)) .. "%",
        SMLSIZE + CENTER + ink
    )
    local top = 42
    local bottom = height - 4
    if bottom - top >= 12 then
        local function y(volts)
            return bottom - (math.max(
                NEVER,
                math.min(4.2, volts)
            ) - NEVER) / (4.2 - NEVER) * (bottom - top)
        end
        lcd.drawLine(
            6,
            math.floor(y(LAND)),
            width - 6,
            math.floor(y(LAND)),
            DOTTED,
            lcd.RGB(16756768)
        )
        local step = (width - 12) / (SAMPLES - 1)
        do
            local index = 1
            while index < #widget.samples do
                local x1 = 6 + (index - 1 + SAMPLES - #widget.samples) * step
                lcd.drawLine(
                    x1,
                    y(widget.samples[index]),
                    x1 + step,
                    y(widget.samples[index + 1]),
                    SOLID,
                    cellColor(widget.samples[index + 1])
                )
                index = index + 1
            end
        end
    end
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
