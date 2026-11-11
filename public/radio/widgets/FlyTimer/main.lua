local ____exports = {}
local name = "FlyTimer"
--- Time in the air on this pack: it counts only while the pack draws over 2 A (the rotor driven), as Flightdown counts
-- it, so time on the bench does not count. A bar fills towards the time to land at, amber past 80 %, red past it, with
-- a buzz when it is reached. A new pack starts it again.
local options = {{
    "LandAt",
    VALUE,
    272,
    60,
    900
}}
--- Under this the motor only idles.
local DRIVEN_AMPS = 2
--- A new pack: its voltage back after none with the mAh count at 0. The model resets the count only when telemetry
-- stops while disarmed (SA), so a dropout in flight is not a new pack.
local NEW_PACK_MAH = 5
local function create(zone, options)
    return {
        zone = zone,
        options = options,
        seconds = 0,
        lastTime = getTime(),
        buzzed = false,
        powered = false
    }
end
local function update(widget, options)
    widget.options = options
end
local function clock(seconds)
    return string.format(
        "%d:%02d",
        math.floor(seconds / 60),
        math.floor(seconds % 60)
    )
end
local function draw(widget, width, height)
    local now = getTime()
    local elapsed = math.min(
        50,
        math.max(0, now - widget.lastTime)
    ) / 100
    widget.lastTime = now
    local powered = getValue("VFAS") > 0.5
    if powered and not widget.powered and getValue("mAh") < NEW_PACK_MAH then
        widget.seconds = 0
        widget.buzzed = false
    end
    widget.powered = powered
    if powered and getValue("Curr") >= DRIVEN_AMPS then
        widget.seconds = widget.seconds + elapsed
    end
    local landAt = widget.options.LandAt or 272
    local share = math.min(1, widget.seconds / landAt)
    local color = share >= 1 and lcd.RGB(16734815) or (share >= 0.8 and lcd.RGB(16756768) or lcd.RGB(8181402))
    if share >= 1 and not widget.buzzed then
        widget.buzzed = true
        playHaptic(30, 100)
        playTone(1500, 300, 0)
    end
    lcd.drawText(
        6,
        2,
        "In the air",
        SMLSIZE + lcd.RGB(10134445)
    )
    lcd.drawText(
        width - 6,
        2,
        "land at " .. clock(landAt),
        SMLSIZE + RIGHT + lcd.RGB(10134445)
    )
    lcd.drawText(
        6,
        14,
        clock(widget.seconds),
        (height >= 60 and DBLSIZE or MIDSIZE) + BOLD + color
    )
    local barY = height - 12
    lcd.drawFilledRectangle(
        6,
        barY,
        width - 12,
        6,
        lcd.RGB(3817544)
    )
    lcd.drawFilledRectangle(
        6,
        barY,
        math.floor((width - 12) * share),
        6,
        color
    )
    local mark = 6 + math.floor((width - 12) * 0.8)
    lcd.drawLine(
        mark,
        barY - 3,
        mark,
        barY + 8,
        SOLID,
        lcd.RGB(16756768)
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
